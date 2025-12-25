package utils

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

func parseTotalFromContentRange(header string) (int64, bool) {
	if header == "" {
		return 0, false
	}
	slash := strings.LastIndex(header, "/")
	if slash == -1 || slash == len(header)-1 {
		return 0, false
	}
	totalStr := header[slash+1:]
	if totalStr == "*" {
		return 0, false
	}
	total, err := strconv.ParseInt(totalStr, 10, 64)
	if err != nil || total <= 0 {
		return 0, false
	}
	return total, true
}

func DownloadWithResume(url string, destPath string, onProgress func(int64, int64, float64)) error {
	client := &http.Client{}

	var knownTotal int64 = -1
	if headReq, err := http.NewRequest("HEAD", url, nil); err == nil {
		if headResp, err := client.Do(headReq); err == nil {
			if headResp.Body != nil {
				headResp.Body.Close()
			}
			if headResp.StatusCode >= 200 && headResp.StatusCode < 300 {
				if headResp.ContentLength > 0 {
					knownTotal = headResp.ContentLength
				}
				if cr := headResp.Header.Get("Content-Range"); knownTotal <= 0 && cr != "" {
					if t, ok := parseTotalFromContentRange(cr); ok {
						knownTotal = t
					}
				}
			}
		}
	}

	backoff := time.Second
	maxBackoff := 10 * time.Second

	for {
		var offset int64 = 0
		if st, err := os.Stat(destPath); err == nil {
			offset = st.Size()
		} else if !os.IsNotExist(err) {
			return err
		}

		req, err := http.NewRequest("GET", url, nil)
		if err != nil {
			return err
		}
		if offset > 0 {
			req.Header.Set("Range", fmt.Sprintf("bytes=%d-", offset))
		}

		resp, err := client.Do(req)
		if err != nil {
			time.Sleep(backoff)
			if backoff < maxBackoff {
				backoff *= 2
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
			}
			continue
		}

		if offset > 0 && resp.StatusCode == http.StatusOK {
			if resp.Body != nil {
				resp.Body.Close()
			}
			if err := os.Truncate(destPath, 0); err != nil {
				return err
			}
			offset = 0
			continue
		}

		if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusPartialContent {
			b, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
			if resp.Body != nil {
				resp.Body.Close()
			}
			return fmt.Errorf("unexpected status %s: %s", resp.Status, strings.TrimSpace(string(b)))
		}

		if knownTotal <= 0 {
			if resp.StatusCode == http.StatusPartialContent {
				if t, ok := parseTotalFromContentRange(resp.Header.Get("Content-Range")); ok {
					knownTotal = t
				}
			} else if resp.ContentLength > 0 {
				knownTotal = resp.ContentLength
			}
		}

		f, err := os.OpenFile(destPath, os.O_CREATE|os.O_WRONLY, 0644)
		if err != nil {
			if resp.Body != nil {
				resp.Body.Close()
			}
			return err
		}
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			f.Close()
			if resp.Body != nil {
				resp.Body.Close()
			}
			return err
		}

		pr := NewProgressReader(resp.Body, knownTotal, func(complete, total int64, speed float64) {
			onProgress(offset+complete, knownTotal, speed)
		})

		_, err = io.Copy(f, pr)
		f.Close()
		if resp.Body != nil {
			resp.Body.Close()
		}
		if err != nil {
			time.Sleep(backoff)
			if backoff < maxBackoff {
				backoff *= 2
				if backoff > maxBackoff {
					backoff = maxBackoff
				}
			}
			continue
		}

		if st, err := os.Stat(destPath); err == nil {
			if knownTotal > 0 && st.Size() >= knownTotal {
				onProgress(knownTotal, knownTotal, 0)
				return nil
			}
		}

		time.Sleep(backoff)
		if backoff < maxBackoff {
			backoff *= 2
			if backoff > maxBackoff {
				backoff = maxBackoff
			}
		}
	}
}
