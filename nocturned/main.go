package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vishvananda/netlink"

	"github.com/usenocturne/nocturned/bluetooth"
	"github.com/usenocturne/nocturned/utils"
)

type InfoResponse struct {
	Version string  `json:"version"`
	Serial  *string `json:"serial"`
}

type ErrorResponse struct {
	Error string `json:"error"`
}

type NetworkStatusResponse struct {
	Status string `json:"status"`
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func corsMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func networkChecker(hub *utils.WebSocketHub) {
	const (
		host          = "1.1.1.1"
		interval      = 1 // seconds
		failThreshold = 5
	)

	failCount := 0
	isOnline := false

	pingHost := func() bool {
		cmd := exec.Command("ping", "-c", "1", "-W", "1", host)
		err := cmd.Run()
		return err == nil
	}

	if pingHost() {
		currentNetworkStatus = "online"
		hub.Broadcast(utils.WebSocketEvent{
			Type:    "network_status",
			Payload: map[string]string{"status": "online"},
		})
		isOnline = true
	} else {
		currentNetworkStatus = "offline"
		hub.Broadcast(utils.WebSocketEvent{
			Type:    "network_status",
			Payload: map[string]string{"status": "offline"},
		})
	}

	for {
		if pingHost() {
			failCount = 0
			if !isOnline {
				currentNetworkStatus = "online"
				hub.Broadcast(utils.WebSocketEvent{
					Type:    "network_status",
					Payload: map[string]string{"status": "online"},
				})
				isOnline = true
			}
		} else {
			failCount++
		}

		if failCount >= failThreshold && isOnline {
			currentNetworkStatus = "offline"
			hub.Broadcast(utils.WebSocketEvent{
				Type:    "network_status",
				Payload: map[string]string{"status": "offline"},
			})
			isOnline = false
		}

		time.Sleep(interval * time.Second)
	}
}

var currentNetworkStatus = "offline"

func main() {
	wsHub := utils.NewWebSocketHub()

	btManager, err := bluetooth.NewBluetoothManager(wsHub)
	if err != nil {
		log.Fatal("Failed to initialize bluetooth manager:", err)
	}

	if err := utils.InitBrightness(); err != nil {
		log.Printf("Failed to initialize brightness: %v", err)
	}

	broadcastProgress := func(progress utils.ProgressMessage) {
		wsHub.Broadcast(utils.WebSocketEvent{
			Type:    "update_progress",
			Payload: progress,
		})
	}

	broadcastCompletion := func(completion utils.CompletionMessage) {
		wsHub.Broadcast(utils.WebSocketEvent{
			Type:    "update_completion",
			Payload: completion,
		})
	}

	// WebSockets
	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("Failed to upgrade connection: %v", err)
			return
		}
		wsHub.AddClient(conn)
	})

	// GET /info
	http.HandleFunc("/info", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		versionContent, err := os.ReadFile("/etc/nocturne/version.txt")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Error reading version file"})
			return
		}
		version := strings.TrimSpace(string(versionContent))

		serialContent, err := os.ReadFile("/sys/class/efuse/usid")
		var serial *string
		if err != nil {
			serial = nil
		} else {
			s := strings.TrimSpace(string(serialContent))
			serial = &s
		}

		response := InfoResponse{
			Version: version,
			Serial:  serial,
		}

		if err := json.NewEncoder(w).Encode(response); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Error encoding response"})
			return
		}
	}))

	// POST /bluetooth/discover/on
	http.HandleFunc("/bluetooth/discover/on", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := btManager.SetDiscoverable(true); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to enable discoverable mode: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /bluetooth/discover/off
	http.HandleFunc("/bluetooth/discover/off", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := btManager.SetDiscoverable(false); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to disable discoverable mode"})
			return
		}

		w.WriteHeader(http.StatusOK)
	}))

	// POST /bluetooth/pairing/accept
	http.HandleFunc("/bluetooth/pairing/accept", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := btManager.AcceptPairing(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to accept pairing"})
			return
		}

		w.WriteHeader(http.StatusOK)
	}))

	// POST /bluetooth/pairing/deny
	http.HandleFunc("/bluetooth/pairing/deny", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := btManager.DenyPairing(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to deny pairing"})
			return
		}

		w.WriteHeader(http.StatusOK)
	}))

	// GET /bluetooth/info/{address}
	http.HandleFunc("/bluetooth/info/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		address := strings.TrimPrefix(r.URL.Path, "/bluetooth/info/")
		if address == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Bluetooth address is required"})
			return
		}

		info, err := btManager.GetDeviceInfo(address)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to get device info: " + err.Error()})
			return
		}

		if err := json.NewEncoder(w).Encode(info); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Error encoding response: " + err.Error()})
			return
		}
	}))

	// POST /bluetooth/remove/{address}
	http.HandleFunc("/bluetooth/remove/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		address := strings.TrimPrefix(r.URL.Path, "/bluetooth/remove/")
		if address == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Bluetooth address is required"})
			return
		}

		if err := btManager.RemoveDevice(address); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to remove device: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
	}))

	// POST /bluetooth/connect/{address}
	http.HandleFunc("/bluetooth/connect/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		address := strings.TrimPrefix(r.URL.Path, "/bluetooth/connect/")
		if address == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Bluetooth address is required"})
			return
		}

		if err := btManager.ConnectDevice(address); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to connect to device: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /bluetooth/disconnect/{address}
	http.HandleFunc("/bluetooth/disconnect/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		address := strings.TrimPrefix(r.URL.Path, "/bluetooth/disconnect/")
		if address == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Bluetooth address is required"})
			return
		}

		if err := btManager.DisconnectDevice(address); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to disconnect device: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// GET /bluetooth/network
	http.HandleFunc("/bluetooth/network", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		link, err := netlink.LinkByName("bnep0")
		if err != nil || link.Attrs().Flags&net.FlagUp == 0 {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "down"})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "up"})
	}))

	// POST /bluetooth/network/{address}
	http.HandleFunc("/bluetooth/network/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		address := strings.TrimPrefix(r.URL.Path, "/bluetooth/network/")
		if address == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Bluetooth address is required"})
			return
		}

		if err := btManager.ConnectNetwork(address); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to connect to Bluetooth network: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// GET /bluetooth/devices
	http.HandleFunc("/bluetooth/devices", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		devices, err := btManager.GetDevices()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to get devices: " + err.Error()})
			return
		}

		if devices == nil {
			devices = []utils.BluetoothDeviceInfo{}
		}

		if err := json.NewEncoder(w).Encode(devices); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Error encoding response: " + err.Error()})
			return
		}
	}))

	// GET /device/brightness
	http.HandleFunc("/device/brightness", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		config, err := utils.GetBrightnessConfig()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to get brightness config: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(config)
	}))

	// POST /device/brightness/{value}
	http.HandleFunc("/device/brightness/", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		valueStr := strings.TrimPrefix(r.URL.Path, "/device/brightness/")
		value, err := strconv.Atoi(valueStr)
		if err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid brightness value"})
			return
		}

		if err := utils.SetBrightness(value); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to set brightness: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /device/brightness/auto
	http.HandleFunc("/device/brightness/auto", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		var request struct {
			Enabled bool `json:"enabled"`
		}

		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid request body"})
			return
		}

		if err := utils.SetAutoBrightness(request.Enabled, true); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to set auto brightness: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /device/resetcounter
	http.HandleFunc("/device/resetcounter", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := utils.ResetCounter(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /device/factoryreset
	http.HandleFunc("/device/factoryreset", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := utils.FactoryReset(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /device/power/shutdown
	http.HandleFunc("/device/power/shutdown", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := utils.Shutdown(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /device/exec
	http.HandleFunc("/device/exec", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		var requestData struct {
			Commands []string `json:"commands"`
		}
		if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid request body: " + err.Error()})
			return
		}

		if len(requestData.Commands) == 0 {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "No commands provided"})
			return
		}

		type CommandResult struct {
			Command  string `json:"command"`
			Output   string `json:"output"`
			Error    string `json:"error,omitempty"`
			ExitCode int    `json:"exit_code"`
		}

		var results []CommandResult

		for _, cmdStr := range requestData.Commands {
			parts := strings.Fields(cmdStr)
			if len(parts) == 0 {
				results = append(results, CommandResult{
					Command:  cmdStr,
					Error:    "Empty command",
					ExitCode: -1,
				})
				continue
			}

			cmd := exec.Command(parts[0], parts[1:]...)
			output, err := cmd.CombinedOutput()
			exitCode := 0
			if err != nil {
				if exitError, ok := err.(*exec.ExitError); ok {
					exitCode = exitError.ExitCode()
				} else {
					exitCode = -1
				}
			}

			result := CommandResult{
				Command:  cmdStr,
				Output:   string(output),
				ExitCode: exitCode,
			}
			if err != nil {
				result.Error = err.Error()
			}

			results = append(results, result)
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "success",
			"results": results,
		})
	}))

	// POST /device/power/reboot
	http.HandleFunc("/device/power/reboot", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := utils.Reboot(); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success"})
	}))

	// POST /device/date/settimezone
	http.HandleFunc("/device/date/settimezone", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		var tz string

		body, _ := io.ReadAll(r.Body)
		if len(body) > 0 {
			var directReq struct {
				Timezone string `json:"timezone"`
			}
			if err := json.Unmarshal(body, &directReq); err != nil {
				w.WriteHeader(http.StatusBadRequest)
				json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid request body: " + err.Error()})
				return
			}
			if strings.TrimSpace(directReq.Timezone) != "" {
				tz = strings.TrimSpace(directReq.Timezone)
			}
		}

		if tz == "" {
			resp, err := http.Get("https://api.usenocturne.com/v1/timezone")
			if err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to fetch timezone: " + err.Error()})
				return
			}
			defer resp.Body.Close()

			var requestData struct {
				Timezone string `json:"timezone"`
			}
			if err := json.NewDecoder(resp.Body).Decode(&requestData); err != nil {
				w.WriteHeader(http.StatusInternalServerError)
				json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to decode timezone response: " + err.Error()})
				return
			}
			tz = requestData.Timezone
		}

		if err := utils.SetTimezone(tz); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]string{"status": "success", "timezone": tz})
	}))

	// GET /device/date
	http.HandleFunc("/device/date", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		cmd := exec.Command("date", "+%Y-%m-%d|%T")
		output, err := cmd.Output()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to get date: " + err.Error()})
			return
		}

		parts := strings.Split(strings.TrimSpace(string(output)), "|")
		if len(parts) != 2 {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Unexpected date output"})
			return
		}

		tz, tzErr := utils.GetTimezone()
		resp := map[string]string{
			"date":     parts[0],
			"time":     parts[1],
			"timezone": tz,
		}
		if tzErr != nil {
			resp["timezone_error"] = tzErr.Error()
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(resp)
	}))

	// GET /device/date/timezones
	http.HandleFunc("/device/date/timezones", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		zones, err := utils.ListTimezones()
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to list timezones: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(zones)
	}))

	// POST /update
	http.HandleFunc("/update", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		var requestData utils.UpdateRequest
		if err := json.NewDecoder(r.Body).Decode(&requestData); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid request body: " + err.Error()})
			return
		}

		status := utils.GetUpdateStatus()
		if status.InProgress {
			w.WriteHeader(http.StatusConflict)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Update already in progress"})
			return
		}

		go func() {
			utils.SetUpdateStatus(true, "download", "")

			tempDir, err := os.MkdirTemp("/var/tmp", "update-*")
			if err != nil {
				utils.SetUpdateStatus(false, "", fmt.Sprintf("Failed to create temp directory: %v", err))
				return
			}
			defer os.RemoveAll(tempDir)

			imgPath := filepath.Join(tempDir, "update.tar.zst")
			if err := utils.DownloadWithResume(requestData.ImageURL, imgPath, func(complete, total int64, speed float64) {
				if total > 0 {
					percent := float64(complete) / float64(total) * 100
					broadcastProgress(utils.ProgressMessage{
						Type:          "progress",
						Stage:         "download",
						BytesComplete: complete,
						BytesTotal:    total,
						Speed:         float64(int(speed*10)) / 10,
						Percent:       float64(int(percent*10)) / 10,
					})
				}
			}); err != nil {
				utils.SetUpdateStatus(false, "", fmt.Sprintf("Failed to download image: %v", err))
				return
			}

			utils.SetUpdateStatus(true, "flash", "")
			if err := utils.UpdateSystem(imgPath, requestData.Sum, broadcastProgress); err != nil {
				utils.SetUpdateStatus(false, "", fmt.Sprintf("Failed to update system: %v", err))
				broadcastCompletion(utils.CompletionMessage{
					Type:    "completion",
					Stage:   "flash",
					Success: false,
					Error:   fmt.Sprintf("Failed to update system: %v", err),
				})
				return
			}

			utils.SetUpdateStatus(false, "", "")
			broadcastCompletion(utils.CompletionMessage{
				Type:    "completion",
				Stage:   "flash",
				Success: true,
			})
		}()

		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(utils.OKResponse{Status: "success"}); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to encode JSON: " + err.Error()})
			return
		}
	}))

	// GET /update/status
	http.HandleFunc("/update/status", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		if err := json.NewEncoder(w).Encode(utils.GetUpdateStatus()); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to encode JSON: " + err.Error()})
			return
		}
	}))

	// POST /fetchjson
	http.HandleFunc("/fetchjson", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		var req struct {
			URL string `json:"url"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.URL == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Missing or invalid url"})
			return
		}

		client := &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if len(via) >= 10 { // 10 redirects, may change?
					return http.ErrUseLastResponse
				}
				return nil
			},
		}
		resp, err := client.Get(req.URL)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to fetch remote JSON: " + err.Error()})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			w.WriteHeader(http.StatusBadGateway)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Remote server returned status: " + resp.Status})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if _, err := io.Copy(w, resp.Body); err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to write JSON: " + err.Error()})
			return
		}
	}))

	go networkChecker(wsHub)

	// GET /network/status
	http.HandleFunc("/network/status", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		response := NetworkStatusResponse{
			Status: currentNetworkStatus,
		}
		json.NewEncoder(w).Encode(response)
	}))

	// POST /auth/start - Start PKCE auth flow
	http.HandleFunc("/auth/start", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		var req struct {
			ClientID    string `json:"client_id"`
			RedirectURI string `json:"redirect_uri"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid request body: " + err.Error()})
			return
		}

		if req.ClientID == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "client_id is required"})
			return
		}

		// Default redirect URI if not provided
		if req.RedirectURI == "" {
			req.RedirectURI = "http://127.0.0.1:5000/auth/callback"
		}

		authResp, err := utils.StartPKCEAuth(req.ClientID, req.RedirectURI)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to start auth: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(authResp)
	}))

	// GET /auth/callback - Handle Spotify OAuth callback
	http.HandleFunc("/auth/callback", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		code := r.URL.Query().Get("code")
		state := r.URL.Query().Get("state")
		errorParam := r.URL.Query().Get("error")

		// Check for OAuth error
		if errorParam != "" {
			errorDesc := r.URL.Query().Get("error_description")
			wsHub.Broadcast(utils.WebSocketEvent{
				Type: "auth_error",
				Payload: map[string]string{
					"error":       errorParam,
					"description": errorDesc,
				},
			})
			// Return HTML page that shows error
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `<!DOCTYPE html><html><head><title>Auth Failed</title></head><body style="background:#1a1a1a;color:#fff;font-family:sans-serif;text-align:center;padding:50px;"><h1 style="color:#e74c3c;">Authentication Failed</h1><p>%s: %s</p><p>You can close this window.</p></body></html>`, errorParam, errorDesc)
			return
		}

		if code == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Missing authorization code"})
			return
		}

		tokens, err := utils.HandlePKCECallback(code, state)
		if err != nil {
			wsHub.Broadcast(utils.WebSocketEvent{
				Type: "auth_error",
				Payload: map[string]string{
					"error": err.Error(),
				},
			})
			// Return HTML page that shows error
			w.Header().Set("Content-Type", "text/html")
			w.WriteHeader(http.StatusOK)
			fmt.Fprintf(w, `<!DOCTYPE html><html><head><title>Auth Failed</title></head><body style="background:#1a1a1a;color:#fff;font-family:sans-serif;text-align:center;padding:50px;"><h1 style="color:#e74c3c;">Authentication Failed</h1><p>%s</p><p>You can close this window.</p></body></html>`, err.Error())
			return
		}

		// Broadcast tokens to UI via WebSocket
		wsHub.Broadcast(utils.WebSocketEvent{
			Type:    "auth_tokens",
			Payload: tokens,
		})

		// Return HTML page that shows success and can be closed
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(http.StatusOK)
		fmt.Fprint(w, `<!DOCTYPE html><html><head><title>Auth Success</title></head><body style="background:#1a1a1a;color:#fff;font-family:sans-serif;text-align:center;padding:50px;"><h1 style="color:#1db954;">Authentication Successful!</h1><p>You can close this window and return to your Car Thing.</p></body></html>`)
	}))

	// POST /auth/refresh - Refresh access token
	http.HandleFunc("/auth/refresh", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		var req struct {
			ClientID     string `json:"client_id"`
			RefreshToken string `json:"refresh_token"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Invalid request body: " + err.Error()})
			return
		}

		if req.ClientID == "" || req.RefreshToken == "" {
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "client_id and refresh_token are required"})
			return
		}

		tokens, err := utils.RefreshPKCEToken(req.ClientID, req.RefreshToken)
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Failed to refresh token: " + err.Error()})
			return
		}

		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(tokens)
	}))

	// GET /auth/status - Check if auth is in progress
	http.HandleFunc("/auth/status", corsMiddleware(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			json.NewEncoder(w).Encode(ErrorResponse{Error: "Method not allowed"})
			return
		}

		state := utils.GetPendingAuthState()
		json.NewEncoder(w).Encode(map[string]interface{}{
			"pending": state != "",
			"state":   state,
		})
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "5000"
	}

	log.Printf("Server starting on :%s", port)
	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatal(err)
	}
}
