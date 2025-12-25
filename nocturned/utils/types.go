package utils

// Bluetooth
type BluetoothDeviceInfo struct {
	Address           string `json:"address"`
	Name              string `json:"name"`
	Alias             string `json:"alias"`
	Class             string `json:"class"`
	Icon              string `json:"icon"`
	Paired            bool   `json:"paired"`
	Trusted           bool   `json:"trusted"`
	Blocked           bool   `json:"blocked"`
	Connected         bool   `json:"connected"`
	LegacyPairing     bool   `json:"legacyPairing"`
	BatteryPercentage int    `json:"batteryPercentage,omitempty"`
}

type PairingRequest struct {
	Device      string
	Passkey     string
	RequestType string
}

// WebSocket
type WebSocketEvent struct {
	Type    string      `json:"type"`
	Payload interface{} `json:"payload"`
}

type PairingStartedPayload struct {
	Address    string `json:"address"`
	PairingKey string `json:"pairingKey"`
}

type DeviceConnectedPayload struct {
	Address string               `json:"address"`
	Device  *BluetoothDeviceInfo `json:"device,omitempty"`
}

type DeviceDisconnectedPayload struct {
	Address string `json:"address"`
}

type DevicePairedPayload struct {
	Device *BluetoothDeviceInfo `json:"device"`
}

type NetworkConnectedPayload struct {
	Address string `json:"address"`
}
