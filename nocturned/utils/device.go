package utils

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

const (
	brightnessPath     = "/sys/class/backlight/aml-bl/brightness"
	brightnessSavePath = "/var/lib/brightness.json"
	maxBrightness      = 255
	minBrightness      = 1
)

type BrightnessConfig struct {
	Auto       bool `json:"auto"`
	Brightness int  `json:"brightness"`
}

func GetBrightnessConfig() (BrightnessConfig, error) {
	data, err := os.ReadFile(brightnessSavePath)
	if err != nil {
		if os.IsNotExist(err) {
			return BrightnessConfig{
				Auto:       true,
				Brightness: 180,
			}, nil
		}
		return BrightnessConfig{}, fmt.Errorf("failed to read brightness config: %w", err)
	}

	var config BrightnessConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return BrightnessConfig{}, fmt.Errorf("failed to parse brightness config: %w", err)
	}

	return config, nil
}

func SetBrightness(value int) error {
	if value < minBrightness || value > maxBrightness {
		return fmt.Errorf("brightness value must be between %d and %d", minBrightness, maxBrightness)
	}

	err := os.WriteFile(brightnessPath, []byte(fmt.Sprintf("%d", value)), 0644)
	if err != nil {
		return fmt.Errorf("failed to write brightness: %w", err)
	}

	config := BrightnessConfig{
		Auto:       false,
		Brightness: value,
	}

	data, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal brightness config: %w", err)
	}

	err = os.WriteFile(brightnessSavePath, data, 0644)
	if err != nil {
		fmt.Printf("Warning: failed to save brightness config: %v\n", err)
	}

	return nil
}

func SetAutoBrightness(enabled bool, write bool) error {
	var command string
	if enabled {
		command = "sv start auto_brightness"
	} else {
		command = "sv stop auto_brightness"
	}

	args := strings.Fields(command)
	if output, err := ExecuteCommand(args[0], args[1:]...); err != nil {
		return fmt.Errorf("failed to execute command '%s': %v (output: %s)", command, err, output)
	}

	if !write {
		return nil
	}

	var config BrightnessConfig
	data, err := os.ReadFile(brightnessSavePath)
	if err != nil {
		if os.IsNotExist(err) {
			config = BrightnessConfig{
				Auto:       enabled,
				Brightness: 180,
			}
		} else {
			return fmt.Errorf("failed to read brightness config: %w", err)
		}
	} else {
		if err := json.Unmarshal(data, &config); err != nil {
			return fmt.Errorf("failed to parse brightness config: %w", err)
		}
		config.Auto = enabled
	}

	data, err = json.Marshal(config)
	if err != nil {
		return fmt.Errorf("failed to marshal brightness config: %w", err)
	}

	err = os.WriteFile(brightnessSavePath, data, 0644)
	if err != nil {
		return fmt.Errorf("failed to save brightness config: %w", err)
	}

	return nil
}

func InitBrightness() error {
	data, err := os.ReadFile(brightnessSavePath)
	if err != nil {
		return nil
	}

	var config BrightnessConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("failed to parse saved brightness config: %w", err)
	}

	if !config.Auto {
		if err := SetBrightness(config.Brightness); err != nil {
			return err
		}
	}

	return SetAutoBrightness(config.Auto, false)
}

func ResetCounter() error {
	commands := []struct {
		name string
		args []string
	}{
		{"wingman", []string{"ab", "--boot-result", "1"}},
	}

	for _, cmd := range commands {
		if output, err := ExecuteCommand(cmd.name, cmd.args...); err != nil {
			return fmt.Errorf("failed to execute command '%s': %v (output: %s)", cmd.name, err, output)
		}
	}

	return nil
}

func FactoryReset() error {
	commands := []struct {
		name string
		args []string
	}{
		{"uenv", []string{"set", "firstboot", "1"}},
		{"sync", nil},
		{"shutdown", []string{"-r", "now"}},
	}

	for _, cmd := range commands {
		if output, err := ExecuteCommand(cmd.name, cmd.args...); err != nil {
			return fmt.Errorf("failed to execute command '%s': %v (output: %s)", cmd.name, err, output)
		}
	}

	return nil
}

func Shutdown() error {
	commands := []struct {
		name string
		args []string
	}{
		{"halt", nil},
	}

	for _, cmd := range commands {
		if output, err := ExecuteCommand(cmd.name, cmd.args...); err != nil {
			return fmt.Errorf("failed to execute command '%s': %v (output: %s)", cmd.name, err, output)
		}
	}

	return nil
}

func Reboot() error {
	commands := []struct {
		name string
		args []string
	}{
		{"reboot", nil},
	}

	for _, cmd := range commands {
		if output, err := ExecuteCommand(cmd.name, cmd.args...); err != nil {
			return fmt.Errorf("failed to execute command '%s': %v (output: %s)", cmd.name, err, output)
		}
	}

	return nil
}

func SetTimezone(timezone string) error {
	src := fmt.Sprintf("/usr/share/zoneinfo/%s", timezone)
	dst := "/var/local/etc/localtime"

	if err := os.Remove(dst); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to remove existing localtime: %w", err)
	}

	if err := os.Symlink(src, dst); err != nil {
		return fmt.Errorf("failed to create symlink for timezone: %w", err)
	}

	return nil
}

func GetTimezone() (string, error) {
    link, err := os.Readlink("/var/local/etc/localtime")
    if err != nil {
        return "", fmt.Errorf("failed to read timezone link: %w", err)
    }
    const prefix = "/usr/share/zoneinfo/"
    if strings.HasPrefix(link, prefix) {
        return strings.TrimPrefix(link, prefix), nil
    }
    return link, nil
}
