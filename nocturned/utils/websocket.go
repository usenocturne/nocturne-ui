package utils

import (
	"log"
	"sync"

	"github.com/gorilla/websocket"
)

type WebSocketHub struct {
	clients map[*websocket.Conn]bool
	mu      sync.Mutex
}

func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		clients: make(map[*websocket.Conn]bool),
	}
}

func (h *WebSocketHub) AddClient(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.clients[conn] = true
	log.Printf("WebSocket client connected. Total clients: %d", len(h.clients))
}

func (h *WebSocketHub) RemoveClient(conn *websocket.Conn) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if _, ok := h.clients[conn]; ok {
		delete(h.clients, conn)
		conn.Close()
		log.Printf("WebSocket client disconnected. Total clients: %d", len(h.clients))
	}
}

func (h *WebSocketHub) Broadcast(event WebSocketEvent) {
	h.mu.Lock()
	clientCount := len(h.clients)
	log.Printf("Broadcasting to %d clients: %+v", clientCount, event)
	var clientsToRemove []*websocket.Conn

	for conn := range h.clients {
		if err := conn.WriteJSON(event); err != nil {
			log.Printf("Client disconnected: %v", err)
			clientsToRemove = append(clientsToRemove, conn)
			continue
		}
	}
	h.mu.Unlock()

	if len(clientsToRemove) > 0 {
		h.mu.Lock()
		for _, conn := range clientsToRemove {
			delete(h.clients, conn)
			conn.Close()
		}
		h.mu.Unlock()
	}
}
