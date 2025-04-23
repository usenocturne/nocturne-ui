import { useState, useEffect, useCallback, useRef } from 'react';
import { networkAwareRequest, waitForNetwork } from '../utils/networkAwareRequest';

const API_BASE = 'http://localhost:5000';

let globalWsRef = null;
let globalWsListeners = [];
let wsInitialized = false;

let isInitializingDiscovery = false;
let isStoppingDiscovery = false;
let isDevicesFetching = false;

let retryIsCancelled = false;
let isNetworkPollingActive = false;

let globalStopReconnection = false;

const setupGlobalWebSocket = async () => {
  if (globalWsRef) return;

  try {
    console.log('Connecting to WebSocket...');
    const socket = new WebSocket(`ws://${API_BASE.replace('http://', '')}/ws`);
    globalWsRef = socket;

    socket.onopen = () => {
      console.log('Connected to WebSocket');
      globalWsListeners.forEach(listener => listener.onOpen && listener.onOpen(socket));
    };

    socket.onclose = () => {
      console.log('Disconnected from WebSocket');
      globalWsListeners.forEach(listener => listener.onClose && listener.onClose());
      globalWsRef = null;
    };

    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        globalWsListeners.forEach(listener => listener.onMessage && listener.onMessage(data));
      } catch (err) {
        console.error('WebSocket message error:', err);
      }
    };

    socket.onerror = (err) => {
      console.error('WebSocket error:', err);
      globalWsListeners.forEach(listener => listener.onError && listener.onError(err));
      socket.close();
    };
  } catch (error) {
    console.error('Error setting up WebSocket:', error);
  }
};

export const useNocturned = () => {
  const [wsConnected, setWsConnected] = useState(false);
  const listenerIdRef = useRef(null);

  useEffect(() => {
    if (!wsInitialized) {
      setupGlobalWebSocket();
      wsInitialized = true;
    }

    const listenerId = `nocturned-${Date.now()}`;
    listenerIdRef.current = listenerId;

    globalWsListeners.push({
      id: listenerId,
      onOpen: () => {
        setWsConnected(true);
      },
      onClose: () => {
        setWsConnected(false);
      },
      onError: () => {
        setWsConnected(false);
      }
    });

    if (globalWsRef && globalWsRef.readyState === WebSocket.OPEN) {
      setWsConnected(true);
    }

    return () => {
      globalWsListeners = globalWsListeners.filter(
        listener => listener.id !== listenerId
      );
    };
  }, []);

  const apiRequest = useCallback(async (endpoint, method = 'GET', body = null) => {
    const url = `${API_BASE}${endpoint.startsWith('/') ? endpoint : '/' + endpoint}`;

    try {
      const options = {
        method,
        headers: {},
      };

      if (body) {
        options.headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
      }

      const response = await networkAwareRequest(
        () => fetch(url, options),
        { skipNetworkCheck: true }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Request failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`API request failed: ${url}`, error);
      throw error;
    }
  }, []);

  const addMessageListener = useCallback((id, messageHandler) => {
    const listenerId = `${id}-${Date.now()}`;

    globalWsListeners.push({
      id: listenerId,
      onMessage: messageHandler
    });

    return listenerId;
  }, []);

  const removeMessageListener = useCallback((listenerId) => {
    globalWsListeners = globalWsListeners.filter(
      listener => listener.id !== listenerId
    );
  }, []);

  return {
    wsConnected,
    apiRequest,
    addMessageListener,
    removeMessageListener
  };
};

export const useSystemUpdate = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } = useNocturned();

  const [updateStatus, setUpdateStatus] = useState({
    inProgress: false,
    stage: '',
    error: ''
  });
  const [progress, setProgress] = useState({
    bytesComplete: 0,
    bytesTotal: 0,
    speed: 0,
    percent: 0
  });
  const [isUpdating, setIsUpdating] = useState(false);
  const [isError, setIsError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const listenerIdRef = useRef(null);
  const lastSuccessfulStageRef = useRef(null);

  const checkUpdateStatus = useCallback(async () => {
    try {
      const status = await apiRequest('/update/status');
      setUpdateStatus(status);
      setIsUpdating(status.inProgress);

      if (status.stage) {
        lastSuccessfulStageRef.current = status.stage;
      }

      if (status.error) {
        setIsError(true);
        setErrorMessage(status.error);
      } else {
        setIsError(false);
        setErrorMessage('');
      }

      return status;
    } catch (error) {
      console.error('Error checking update status:', error);
      return null;
    }
  }, [apiRequest]);

  const startUpdate = useCallback(async (imageURL, sumURL) => {
    try {
      setIsUpdating(true);
      setIsError(false);
      setErrorMessage('');

      setProgress({
        bytesComplete: 0,
        bytesTotal: 0,
        speed: 0,
        percent: 0
      });

      const data = await apiRequest('/update', 'POST', {
        image_url: imageURL,
        sum_url: sumURL
      });

      return data;
    } catch (error) {
      console.error('Error starting update:', error);
      setIsUpdating(false);
      setIsError(true);
      setErrorMessage(`Failed to start update: ${error.message}`);
      return null;
    }
  }, [apiRequest]);

  const handleWsMessage = useCallback((data) => {
    if (data.type === 'progress') {
      setProgress({
        bytesComplete: data.bytes_complete,
        bytesTotal: data.bytes_total,
        speed: data.speed,
        percent: data.percent
      });

      if (data.stage) {
        lastSuccessfulStageRef.current = data.stage;
        setUpdateStatus(prev => ({
          ...prev,
          stage: data.stage,
          inProgress: true
        }));
      }
    } else if (data.type === 'completion') {
      if (data.success) {
        setUpdateStatus(prev => ({
          ...prev,
          inProgress: false,
          stage: 'complete'
        }));
        setIsUpdating(false);
      } else {
        setIsError(true);
        setErrorMessage(data.error || 'Update failed');
        setIsUpdating(false);
        setUpdateStatus(prev => ({
          ...prev,
          inProgress: false,
          error: data.error || 'Update failed'
        }));
      }

      checkUpdateStatus();
    }
  }, [checkUpdateStatus]);

  useEffect(() => {
    let statusIntervalId = null;

    if (isUpdating) {
      statusIntervalId = setInterval(() => {
        checkUpdateStatus();
      }, 5000);
    }

    return () => {
      if (statusIntervalId) {
        clearInterval(statusIntervalId);
      }
    };
  }, [isUpdating, checkUpdateStatus]);

  useEffect(() => {
    const listenerId = addMessageListener('system-update', handleWsMessage);
    listenerIdRef.current = listenerId;

    checkUpdateStatus();

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
    };
  }, [addMessageListener, removeMessageListener, handleWsMessage, checkUpdateStatus]);

  return {
    updateStatus,
    progress,
    isUpdating,
    isError,
    errorMessage,
    wsConnected,
    startUpdate,
    checkUpdateStatus
  };
};

export const useBluetooth = () => {
  const { wsConnected, apiRequest, addMessageListener, removeMessageListener } = useNocturned();

  const [pairingRequest, setPairingRequest] = useState(null);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [lastConnectedDevice, setLastConnectedDevice] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  const networkPollRef = useRef(null);
  const networkStartRef = useRef(null);
  const retryTimeoutRef = useRef(null);
  const isReconnecting = useRef(false);
  const listenerIdRef = useRef(null);
  const discoveryActive = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const retryDeviceAddressRef = useRef(null);

  const MAX_RECONNECT_ATTEMPTS = 5;
  const RETRY_DELAY = 3000;
  const INITIAL_RECONNECT_DELAY = 1000;

  const requestInFlightRef = useRef(false);

  const stopNetworkPolling = useCallback(() => {
    isNetworkPollingActive = false;
    
    if (networkPollRef.current) {
      clearInterval(networkPollRef.current);
      networkPollRef.current = null;
    }
    if (networkStartRef.current) {
      clearTimeout(networkStartRef.current);
      networkStartRef.current = null;
    }
  }, []);

  const cleanupReconnectTimer = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const resetConnectionState = useCallback(() => {
    globalStopReconnection = false;
    requestInFlightRef.current = false;
    isReconnecting.current = false;
    isNetworkPollingActive = false;
    retryIsCancelled = false;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (networkPollRef.current) {
      clearInterval(networkPollRef.current);
      networkPollRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
  }, []);

  const handleSuccessfulConnection = useCallback((isSuccess = true) => {
    globalStopReconnection = true;
    requestInFlightRef.current = false;
    isReconnecting.current = false;
    isNetworkPollingActive = false;
    retryIsCancelled = true;
    
    if (isSuccess) {
      reconnectAttemptsRef.current = 0;
      setReconnectAttempt(0);
    } else {
      reconnectAttemptsRef.current = MAX_RECONNECT_ATTEMPTS;
      setReconnectAttempt(MAX_RECONNECT_ATTEMPTS);
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (networkPollRef.current) {
      clearInterval(networkPollRef.current);
      networkPollRef.current = null;
    }
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    window.dispatchEvent(new Event('networkBannerHide'));
    window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: true } }));
  }, []);

  const attemptReconnect = useCallback(async (continuous = false, bootMode = false) => {
    if (globalStopReconnection) {
      return;
    }
    
    if (requestInFlightRef.current) {
      return;
    }
    if (isReconnecting.current) {
      return;
    }
  
    isReconnecting.current = true;
    
    try {
      const lastDeviceAddress = localStorage.getItem('lastConnectedBluetoothDevice');
      if (!lastDeviceAddress) {
        handleSuccessfulConnection();
        return;
      }

      const attemptNumber = reconnectAttemptsRef.current + 1;
      
      requestInFlightRef.current = true;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      
      try {
        const response = await fetch(`${API_BASE}/bluetooth/connect/${lastDeviceAddress}`, {
          method: 'POST',
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const data = await response.json().catch(() => ({}));
          if (data.connected) {
            handleSuccessfulConnection(true);
            return;
          }
        }
        
        if (globalStopReconnection) {
          return;
        }
        
        reconnectAttemptsRef.current++;
        setReconnectAttempt(reconnectAttemptsRef.current);
        
        if (bootMode && reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          handleSuccessfulConnection(false); 
          return;
        }
        
        if (!bootMode && !continuous && reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          handleSuccessfulConnection(false); 
          return;
        }

        window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: true } }));

        isReconnecting.current = false;
        
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!globalStopReconnection) {
            attemptReconnect(continuous, bootMode);
          }
        }, RETRY_DELAY);
        
      } catch (error) {
        clearTimeout(timeoutId);
        console.error('Connection request failed:', error);
        
        if (globalStopReconnection) return;
        
        reconnectAttemptsRef.current++;
        setReconnectAttempt(reconnectAttemptsRef.current);
        
        if (bootMode && reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          handleSuccessfulConnection(false);
          return;
        }
        
        window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: true } }));
        
        isReconnecting.current = false;
        reconnectTimeoutRef.current = setTimeout(() => {
          if (!globalStopReconnection) {
            attemptReconnect(continuous, bootMode);
          }
        }, RETRY_DELAY);
      }
    } finally {
      requestInFlightRef.current = false;
    }
  }, [handleSuccessfulConnection]);

  useEffect(() => {
    const lastDeviceAddress = localStorage.getItem('lastConnectedBluetoothDevice');
    if (lastDeviceAddress) {
      fetch(`${API_BASE}/bluetooth/devices`)
        .then(response => response.json())
        .then(devices => {
          const isAlreadyConnected = devices.some(device => 
            device.address === lastDeviceAddress && device.connected
          );
          
          if (!isAlreadyConnected) {
            resetConnectionState();
            const bootMode = true;
            setTimeout(() => {
              attemptReconnect(false, bootMode);
            }, INITIAL_RECONNECT_DELAY);
          } else {
            handleSuccessfulConnection();
          }
        })
        .catch(error => {
          console.error('Error checking device status on load:', error);
        });
    }

    return () => {
      cleanupReconnectTimer();
      resetConnectionState();
    };
  }, [attemptReconnect, cleanupReconnectTimer, resetConnectionState, handleSuccessfulConnection]);

  const stopRetrying = useCallback(() => {
    retryIsCancelled = true;
    
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    
    isReconnecting.current = false;
    retryDeviceAddressRef.current = null;
    window.dispatchEvent(new Event('networkBannerHide'));
  }, []);

  const cleanup = useCallback(() => {
    stopNetworkPolling();
    stopRetrying();
  }, [stopNetworkPolling, stopRetrying]);

  const fetchDevices = useCallback(async (force = false) => {
    if (isDevicesFetching && !force) {
      return [];
    }

    try {
      isDevicesFetching = true;
      setLoading(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/devices`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Failed to fetch devices');
      }

      const data = await response.json();
      setDevices(data);
      return data;
    } catch (err) {
      setError(err.message);
      return [];
    } finally {
      setLoading(false);
      isDevicesFetching = false;
    }
  }, []);

  const startNetworkPolling = useCallback(async (deviceAddress) => {
    console.log('Starting network polling for device:', deviceAddress);
    if (!deviceAddress) {
      console.error('No device address provided to startNetworkPolling');
      return;
    }
    
    stopNetworkPolling();
    stopRetrying();
    retryIsCancelled = false;
    reconnectAttemptsRef.current = 0;
    setReconnectAttempt(0);
    
    isNetworkPollingActive = true;
    window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: true } }));
    
    const attemptNetworkConnection = async () => {
      if (globalStopReconnection || !isNetworkPollingActive || requestInFlightRef.current) return false;
      
      try {
        requestInFlightRef.current = true;
        const response = await fetch(`${API_BASE}/bluetooth/connect/${deviceAddress}`, {
          method: 'POST'
        });
        
        if (response.ok) {
          window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: false } }));
          isNetworkPollingActive = false;
          clearInterval(networkPollRef.current);
          networkPollRef.current = null;
          return true;
        }
      } catch (error) {
        if (isNetworkPollingActive) {
          console.log('Network connection attempt failed, retrying...');
        }
      } finally {
        requestInFlightRef.current = false;
      }
      return false;
    };

    networkPollRef.current = setInterval(async () => {
      if (!isNetworkPollingActive) {
        clearInterval(networkPollRef.current);
        networkPollRef.current = null;
        return;
      }
      const success = await attemptNetworkConnection();
      if (success) {
        isNetworkPollingActive = false;
      }
    }, 2000);
    
    const success = await attemptNetworkConnection();
    if (success) {
      isNetworkPollingActive = false;
      clearInterval(networkPollRef.current);
      networkPollRef.current = null;
    }
    
    setNetworkStartRef(Date.now());
  }, []);

  const connectDevice = useCallback(async (deviceAddress) => {
    try {
      setLoading(true);
      stopRetrying();
      retryIsCancelled = false;
      retryDeviceAddressRef.current = deviceAddress;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      if (requestInFlightRef.current) {
        return false;
      }
      requestInFlightRef.current = true;
      const response = await fetch(`${API_BASE}/bluetooth/connect/${deviceAddress}`, {
        method: 'POST',
        signal: controller.signal
      });
      requestInFlightRef.current = false;

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        
        if (errorData.error === "Failed to connect to device: exit status 4") {
          window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: true } }));
          const retryConnection = () => {
            if (retryIsCancelled) return;
            
            fetch(`${API_BASE}/bluetooth/connect/${deviceAddress}`, {
              method: 'POST'
            })
            .then(retryResponse => {
              if (retryIsCancelled) return;
              
              if (retryResponse.ok) {
                localStorage.setItem('lastConnectedBluetoothDevice', deviceAddress);
                fetchDevices(true);
                startNetworkPolling(deviceAddress);
                retryIsCancelled = true;
                window.dispatchEvent(new Event('networkBannerHide'));
              } else {
                if (!retryIsCancelled) {
                  window.dispatchEvent(new Event('networkBannerShow'));
                  const newTimeout = setTimeout(retryConnection, 5000);
                  setRetryTimeoutRef(newTimeout);
                }
              }
            })
            .catch(error => {
              if (!retryIsCancelled) {
                window.dispatchEvent(new Event('networkBannerShow'));
                const newTimeout = setTimeout(retryConnection, 5000);
                setRetryTimeoutRef(newTimeout);
              }
            });
          };

          window.dispatchEvent(new Event('networkBannerShow'));
          const timeout = setTimeout(retryConnection, 5000);
          setRetryTimeoutRef(timeout);
          
          return false;
        }
        window.dispatchEvent(new Event('networkBannerShow'));
        throw new Error(errorData.error || 'Failed to connect device');
      }

      localStorage.setItem('lastConnectedBluetoothDevice', deviceAddress);
      await fetchDevices(true);
      startNetworkPolling(deviceAddress);
      window.dispatchEvent(new Event('networkBannerHide'));
      return true;

    } catch (err) {
      window.dispatchEvent(new Event('networkBannerShow'));
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchDevices, stopRetrying, startNetworkPolling]);

  const disconnectDevice = useCallback(async (address) => {
    try {
      stopNetworkPolling();
      stopRetrying();
      retryIsCancelled = true;
      isNetworkPollingActive = false;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/disconnect/${address}`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to disconnect device');

      localStorage.removeItem('lastConnectedBluetoothDevice');
      
      setTimeout(() => {
        stopNetworkPolling();
        stopRetrying();
      }, 100);
      
      await fetchDevices(true);
      return true;
    } catch (error) {
      console.error('Error disconnecting:', error);
      return false;
    }
  }, [fetchDevices, stopNetworkPolling, stopRetrying]);

  const forgetDevice = useCallback(async (deviceAddress) => {
    try {
      setLoading(true);
      stopNetworkPolling();
      stopRetrying();
      retryDeviceAddressRef.current = null;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/remove/${deviceAddress}`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to remove device');
      }

      if (localStorage.getItem('lastConnectedBluetoothDevice') === deviceAddress) {
        localStorage.removeItem('lastConnectedBluetoothDevice');
      }
      
      await fetchDevices(true);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, [fetchDevices, stopNetworkPolling, stopRetrying]);

  const handleWsMessage = useCallback((data) => {
    switch (data.type) {
      case 'bluetooth/pairing':
        setPairingRequest(data.payload);
        break;

      case 'bluetooth/paired':
        console.log('Bluetooth paired event received:', data.payload.device);
        setPairingRequest(null);
        setConnectedDevices(prev => [...prev, data.payload.device]);
        setLastConnectedDevice(data.payload.device);
        const deviceAddr = data.payload.device.address;
        localStorage.setItem('lastConnectedBluetoothDevice', deviceAddr);
        resetConnectionState();
        
        window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: true } }));
        setTimeout(() => {
          attemptReconnect(true);
        }, 500);
        break;

      case 'bluetooth/connect':
        handleSuccessfulConnection();
        break;

      case 'bluetooth/network/disconnect':
        if (!retryIsCancelled && !globalStopReconnection) {
          window.dispatchEvent(new Event('offline'));
          window.dispatchEvent(new CustomEvent('tetheringRequired', { detail: { required: true } }));
          resetConnectionState();
          
          setTimeout(() => {
            attemptReconnect(true);
          }, INITIAL_RECONNECT_DELAY);
        }
        break;

      default:
        break;
    }
  }, [lastConnectedDevice, stopNetworkPolling, startNetworkPolling, stopRetrying, attemptReconnect, cleanupReconnectTimer]);

  const startDiscovery = useCallback(async () => {
    if (discoveryActive.current || isInitializingDiscovery) {
      return true;
    }

    try {
      isInitializingDiscovery = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/discover/on`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error('Failed to start discovery');
      }
      discoveryActive.current = true;
      return true;
    } catch (err) {
      console.error('Error starting discovery:', err);
      return false;
    } finally {
      isInitializingDiscovery = false;
    }
  }, []);

  const stopDiscovery = useCallback(async () => {
    if (!discoveryActive.current || isStoppingDiscovery) {
      return;
    }

    try {
      isStoppingDiscovery = true;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      await fetch(`${API_BASE}/bluetooth/discover/off`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      discoveryActive.current = false;
    } catch (err) {
      console.error('Failed to stop discovery:', err);
    } finally {
      isStoppingDiscovery = false;
    }
  }, []);

  const setDiscoverable = useCallback(async (enabled) => {
    return enabled ? startDiscovery() : stopDiscovery();
  }, [startDiscovery, stopDiscovery]);

  const acceptPairing = useCallback(async () => {
    if (!pairingRequest) return;

    try {
      setIsConnecting(true);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/pairing/accept`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to accept pairing');
      setPairingRequest(null);
    } catch (error) {
      console.error('Error accepting pair:', error);
      setPairingRequest(null);
    } finally {
      setIsConnecting(false);
    }
  }, [pairingRequest]);

  const denyPairing = useCallback(async () => {
    if (!pairingRequest) return;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${API_BASE}/bluetooth/pairing/deny`, {
        method: 'POST',
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) throw new Error('Failed to deny pairing');
      setPairingRequest(null);
    } catch (error) {
      console.error('Error denying pair:', error);
      setPairingRequest(null);
    }
  }, [pairingRequest]);

  const enableNetworking = useCallback(async () => {
    if (!lastConnectedDevice) return;
    startNetworkPolling(lastConnectedDevice.address);
  }, [lastConnectedDevice, startNetworkPolling]);

  useEffect(() => {
    const listenerId = addMessageListener('bluetooth', handleWsMessage);
    listenerIdRef.current = listenerId;

    return () => {
      if (listenerIdRef.current) {
        removeMessageListener(listenerIdRef.current);
      }
      cleanup();
    }
  }, [addMessageListener, removeMessageListener, handleWsMessage, cleanup]);

  return {
    devices,
    loading,
    error,
    fetchDevices,
    pairingRequest,
    connectedDevices,
    isConnecting,
    lastConnectedDevice,
    acceptPairing,
    denyPairing,
    startDiscovery,
    stopDiscovery,
    setDiscoverable,
    connectDevice,
    disconnectDevice,
    forgetDevice,
    enableNetworking,
    wsConnected,
    stopRetrying,
    reconnectAttempt,
    attemptReconnect
  };
};