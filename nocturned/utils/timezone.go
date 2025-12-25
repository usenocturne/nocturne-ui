package utils

import (
	"io/fs"
	"os"
	"path/filepath"
	"sort"
)

func ListTimezones() (map[string][]string, error) {
	root := "/usr/share/zoneinfo"

	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}

	zonesByRegion := make(map[string][]string)

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		regionName := entry.Name()
		if regionName == "posix" || regionName == "right" {
			continue
		}

		regionPath := filepath.Join(root, regionName)

		var regionZones []string
		walkErr := filepath.WalkDir(regionPath, func(path string, d fs.DirEntry, walkErr error) error {
			if walkErr != nil {
				return walkErr
			}
			if d.IsDir() {
				return nil
			}
			rel, err := filepath.Rel(regionPath, path)
			if err != nil {
				return err
			}

			regionZones = append(regionZones, filepath.ToSlash(rel))
			return nil
		})
		if walkErr != nil {
			return nil, walkErr
		}

		sort.Strings(regionZones)
		zonesByRegion[regionName] = regionZones
	}

	return zonesByRegion, nil
}
