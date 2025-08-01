import { useState, useEffect, useRef, useCallback, useContext } from "react";
import { useConnector } from "../contexts/ConnectorContext";
import { NetworkContext } from "../App";

let globalWsRef = null;
let globalWsListeners = [];
let wsInitialized = false;
let reconnectTimeoutRef = null;
const API_BASE = "http://172.16.42.1:20574";
let globalScanInProgress = false;
let globalRescanAfterConnect = false;

const globalNetworkCache = {
  currentNetwork: null,
  savedNetworks: [],
  availableNetworks: [],
  networkStatus: null,
  initialDataFetched: false,
};

const setupGlobalWebSocket = (isConnectorAvailable) => {
  if (globalWsRef || !isConnectorAvailable) return;

  const ws = new WebSocket(`ws://${API_BASE.replace("http://", "")}/ws`);
  globalWsRef = ws;

  ws.onopen = () => {
    console.log("Network WebSocket connected");
    globalWsListeners.forEach(
      (listener) => listener.onOpen && listener.onOpen(),
    );
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      globalWsListeners.forEach(
        (listener) => listener.onMessage && listener.onMessage(data),
      );
    } catch (err) {
      console.error("Connector WebSocket message error:", err);
    }
  };

  ws.onclose = () => {
    console.log("Connector WebSocket disconnected, reconnecting...");
    globalWsListeners.forEach(
      (listener) => listener.onClose && listener.onClose(),
    );
    globalWsRef = null;

    if (reconnectTimeoutRef) {
      clearTimeout(reconnectTimeoutRef);
    }

    reconnectTimeoutRef = setTimeout(() => {
      setupGlobalWebSocket(isConnectorAvailable);
    }, 2000);
  };

  ws.onerror = (err) => {
    console.error("Connector WebSocket error:", err);
    globalWsListeners.forEach(
      (listener) => listener.onError && listener.onError(err),
    );

    ws.close();
  };
};

export function useWiFiNetworks() {
  const { selectedNetwork } = useContext(NetworkContext);
  const { isConnectorAvailable, isLoading: isConnectorLoading } =
    useConnector();
  const [currentNetwork, setCurrentNetwork] = useState(
    globalNetworkCache.currentNetwork,
  );
  const [savedNetworks, setSavedNetworks] = useState(
    globalNetworkCache.savedNetworks,
  );
  const [availableNetworks, setAvailableNetworks] = useState(
    globalNetworkCache.availableNetworks,
  );
  const [networkStatus, setNetworkStatus] = useState(
    globalNetworkCache.networkStatus,
  );
  const [loadingState, setLoadingState] = useState({
    initial: true,
    scanning: false,
    connecting: false,
    forgetting: false,
  });
  const [error, setError] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);

  const scanningRef = useRef(false);
  const statusFetchingRef = useRef(false);
  const savedFetchingRef = useRef(false);
  const pollingIntervalRef = useRef(null);
  const listenerIdRef = useRef(null);

  const handleFetchError = useCallback((error, operation) => {
    console.error(`Error during ${operation}:`, error);
    setError(`${operation} failed: ${error.message}`);
    return null;
  }, []);

  const processNetworks = useCallback((networks) => {
    return networks.filter((network) => {
      return (
        network.ssid &&
        network.ssid.trim() !== "" &&
        !network.flags.includes("[P2P]") &&
        !network.ssid.startsWith("\\x00")
      );
    });
  }, []);

  const combineNetworks = useCallback((networks) => {
    return networks.reduce((acc, network) => {
      const existing = acc.find((n) => n.ssid === network.ssid);
      if (!existing || parseInt(network.signal) > parseInt(existing.signal)) {
        if (existing) {
          acc = acc.filter((n) => n.ssid !== network.ssid);
        }
        acc.push(network);
      }
      return acc;
    }, []);
  }, []);

  const hasPasswordSecurity = useCallback((flags) => {
    const flagStr = flags.toString();
    return flagStr.includes("WPA") || flagStr.includes("WEP");
  }, []);

  const scanNetworks = useCallback(
    async (isInitial = false) => {
      if (selectedNetwork || globalRescanAfterConnect) {
        return [];
      }
      while (globalScanInProgress) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        if (selectedNetwork) return [];
      }

      if (scanningRef.current) return;

      scanningRef.current = true;
      globalScanInProgress = true;

      try {
        setLoadingState((prev) => ({
          ...prev,
          initial: isInitial ? true : prev.initial,
          scanning: true,
        }));
        setError(null);

        const response = await fetch(`${API_BASE}/network/scan`);
        if (!response.ok) {
          throw new Error(`Scan failed with status: ${response.status}`);
        }

        const networks = await response.json();
        const processedNetworks = processNetworks(networks);
        const combinedNetworks = combineNetworks(processedNetworks);

        setAvailableNetworks(combinedNetworks);

        globalNetworkCache.availableNetworks = combinedNetworks;

        await fetchSavedNetworks();

        return combinedNetworks;
      } catch (error) {
        handleFetchError(error, "Network scan");
        try {
          await fetchSavedNetworks();
        } catch (err) {
          console.error(
            "Failed to fetch saved networks after scan error:",
            err,
          );
        }
        return [];
      } finally {
        scanningRef.current = false;
        globalScanInProgress = false;
        setLoadingState((prev) => ({
          ...prev,
          initial: false,
          scanning: false,
        }));
        globalNetworkCache.initialDataFetched = true;
      }
    },
    [processNetworks, combineNetworks, handleFetchError, selectedNetwork],
  );

  const fetchNetworkStatus = useCallback(async () => {
    if (statusFetchingRef.current) return null;
    statusFetchingRef.current = true;

    let statusData = null;

    try {
      const response = await fetch(`${API_BASE}/network`);
      if (!response.ok) {
        throw new Error(`Status fetch failed with status: ${response.status}`);
      }

      statusData = await response.json();
      setNetworkStatus(statusData);

      return statusData;
    } catch (error) {
      handleFetchError(error, "Network status fetch");
      return null;
    } finally {
      statusFetchingRef.current = false;
      if (statusData) {
        globalNetworkCache.networkStatus = statusData;
      }
    }
  }, [handleFetchError]);

  const fetchSavedNetworks = useCallback(async () => {
    if (savedFetchingRef.current) return;
    savedFetchingRef.current = true;

    let currentNetworkData = null;
    let savedNetworksData = [];

    try {
      const response = await fetch(`${API_BASE}/network/list`);
      if (!response.ok) {
        throw new Error(
          `Saved networks fetch failed with status: ${response.status}`,
        );
      }

      const networks = await response.json();

      const current = networks.find((network) =>
        network.flags.includes("[CURRENT]"),
      );

      if (current) {
        const availableNetwork = availableNetworks.find(
          (n) => n.ssid === current.ssid,
        );
        if (availableNetwork) {
          current.signal = availableNetwork.signal;
        }
        currentNetworkData = current;
        setCurrentNetwork(current);
      } else {
        setCurrentNetwork(null);
      }

      const saved = networks.filter(
        (network) => !network.flags.includes("[CURRENT]"),
      );
      savedNetworksData = saved;
      setSavedNetworks(saved);

      return networks;
    } catch (error) {
      handleFetchError(error, "Saved networks fetch");
      return [];
    } finally {
      savedFetchingRef.current = false;
      globalNetworkCache.currentNetwork = currentNetworkData;
      globalNetworkCache.savedNetworks = savedNetworksData;
    }
  }, [availableNetworks, handleFetchError]);

  const pollConnectionStatus = async (maxAttempts = 10, interval = 2000) => {
    for (let i = 0; i < maxAttempts; i++) {
      const status = await fetchNetworkStatus();
      if (status && (status.wpaState === "COMPLETED" || status.networkId)) {
        return true;
      }
      await new Promise((r) => setTimeout(r, interval));
    }
    return false;
  };

  const connectToNetwork = useCallback(
    async (network, password = null) => {
      globalRescanAfterConnect = true;
      setLoadingState((prev) => ({ ...prev, connecting: true }));
      setError(null);

      try {
        const savedNetworkResponse = await fetch(`${API_BASE}/network/list`);
        if (!savedNetworkResponse.ok) {
          throw new Error("Failed to check saved networks");
        }

        const savedNetworks = await savedNetworkResponse.json();
        const existingSavedNetwork = savedNetworks.find(
          (n) => n.ssid === network.ssid,
        );

        if (existingSavedNetwork) {
          const selectResponse = await fetch(
            `${API_BASE}/network/select/${existingSavedNetwork.networkId}`,
            {
              method: "POST",
            },
          );

          if (!selectResponse.ok) {
            throw new Error(
              `Failed to select network: ${selectResponse.status}`,
            );
          }
        } else {
          const connectResponse = await fetch(`${API_BASE}/network/connect`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              ssid: network.ssid,
              ...(password && { psk: password }),
            }),
          });

          if (!connectResponse.ok) {
            throw new Error(
              `Failed to connect to network: ${connectResponse.status}`,
            );
          }

          try {
            const listResp = await fetch(`${API_BASE}/network/list`);
            if (listResp.ok) {
              const listData = await listResp.json();
              const newlySaved = listData.find((n) => n.ssid === network.ssid);
              if (newlySaved && newlySaved.networkId) {
                await fetch(
                  `${API_BASE}/network/select/${newlySaved.networkId}`,
                  { method: "POST" },
                );
              }
            }
          } catch (err) {
            console.error("Failed to select newly added network:", err);
          }
        }

        const connected = await pollConnectionStatus();
        if (!connected) {
          await scanNetworks(false);
          await fetchNetworkStatus();
          throw new Error("Failed to establish connection to network");
        }

        return true;
      } catch (error) {
        handleFetchError(error, "Network connection");
        return false;
      } finally {
        setLoadingState((prev) => ({ ...prev, connecting: false }));
      }
    },
    [scanNetworks, fetchNetworkStatus, handleFetchError, hasPasswordSecurity],
  );

  const connectToSavedNetwork = useCallback(
    async (networkId) => {
      globalRescanAfterConnect = true;
      setLoadingState((prev) => ({ ...prev, connecting: true }));
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE}/network/select/${networkId}`,
          {
            method: "POST",
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to select network: ${response.status}`);
        }

        const connected = await pollConnectionStatus();
        if (!connected) {
          await scanNetworks(false);
          await fetchNetworkStatus();
          throw new Error("Failed to establish connection to network");
        }

        return true;
      } catch (error) {
        handleFetchError(error, "Connect to saved network");
        return false;
      } finally {
        setLoadingState((prev) => ({ ...prev, connecting: false }));
      }
    },
    [scanNetworks, fetchNetworkStatus, handleFetchError],
  );

  const forgetNetwork = useCallback(
    async (networkId) => {
      setLoadingState((prev) => ({ ...prev, forgetting: true }));
      setError(null);

      try {
        const response = await fetch(
          `${API_BASE}/network/remove/${networkId}`,
          {
            method: "DELETE",
          },
        );

        if (!response.ok) {
          throw new Error(`Failed to remove network: ${response.status}`);
        }

        await scanNetworks();

        return true;
      } catch (error) {
        handleFetchError(error, "Forget network");
        return false;
      } finally {
        setLoadingState((prev) => ({ ...prev, forgetting: false }));
      }
    },
    [scanNetworks, handleFetchError],
  );

  const handleWsMessage = useCallback(
    (data) => {
      if (data.type === "network") {
        fetchNetworkStatus();
        if (!globalRescanAfterConnect) {
          scanNetworks(false);
        }
      }
    },
    [fetchNetworkStatus, scanNetworks],
  );

  useEffect(() => {
    if (!isConnectorLoading && !isConnectorAvailable) {
      setError("Connector is unavailable");
      return;
    }

    if (!wsInitialized && isConnectorAvailable) {
      setupGlobalWebSocket(isConnectorAvailable);
      wsInitialized = true;
    }

    const listenerId = Date.now().toString() + Math.random().toString();
    listenerIdRef.current = listenerId;

    if (isConnectorAvailable) {
      const isFirstListener = globalWsListeners.length === 0;
      globalWsListeners.push({
        id: listenerId,
        onOpen: () => setWsConnected(true),
        onClose: () => setWsConnected(false),
        onMessage: handleWsMessage,
        onError: () => setWsConnected(false),
      });

      if (globalWsRef && globalWsRef.readyState === WebSocket.OPEN) {
        setWsConnected(true);
      }

      const init = async () => {
        await scanNetworks(true);
        await fetchNetworkStatus();
      };

      if (isFirstListener) {
        init();
      } else if (globalNetworkCache.initialDataFetched) {
        setAvailableNetworks(globalNetworkCache.availableNetworks);
        setSavedNetworks(globalNetworkCache.savedNetworks);
        setCurrentNetwork(globalNetworkCache.currentNetwork);
        setNetworkStatus(globalNetworkCache.networkStatus);
      } else {
        const pollCache = async () => {
          while (!globalNetworkCache.initialDataFetched) {
            await new Promise((r) => setTimeout(r, 50));
          }
          setAvailableNetworks(globalNetworkCache.availableNetworks);
          setSavedNetworks(globalNetworkCache.savedNetworks);
          setCurrentNetwork(globalNetworkCache.currentNetwork);
          setNetworkStatus(globalNetworkCache.networkStatus);
        };
        pollCache();
      }
    }

    return () => {
      globalWsListeners = globalWsListeners.filter(
        (listener) => listener.id !== listenerId,
      );
    };
  }, [
    scanNetworks,
    fetchNetworkStatus,
    handleWsMessage,
    isConnectorAvailable,
    isConnectorLoading,
  ]);

  useEffect(() => {
    if (
      !loadingState.connecting &&
      !selectedNetwork &&
      globalRescanAfterConnect
    ) {
      const timeoutId = setTimeout(() => {
        globalRescanAfterConnect = false;
        scanNetworks(false);
      }, 5000);

      return () => clearTimeout(timeoutId);
    }
  }, [loadingState.connecting, selectedNetwork, scanNetworks]);

  useEffect(() => {
    globalNetworkCache.currentNetwork = currentNetwork;
  }, [currentNetwork]);

  useEffect(() => {
    globalNetworkCache.availableNetworks = availableNetworks;
  }, [availableNetworks]);

  useEffect(() => {
    globalNetworkCache.savedNetworks = savedNetworks;
  }, [savedNetworks]);

  useEffect(() => {
    globalNetworkCache.networkStatus = networkStatus;
  }, [networkStatus]);

  return {
    currentNetwork,
    savedNetworks,
    availableNetworks,
    networkStatus,
    error,
    wsConnected,
    isConnectorAvailable,

    isInitialLoading: loadingState.initial || isConnectorLoading,
    isScanning: loadingState.scanning,
    isConnecting: loadingState.connecting,
    isForgetting: loadingState.forgetting,

    scanNetworks: isConnectorAvailable ? scanNetworks : () => {},
    connectToNetwork: isConnectorAvailable ? connectToNetwork : () => {},
    connectToSavedNetwork: isConnectorAvailable
      ? connectToSavedNetwork
      : () => {},
    forgetNetwork: isConnectorAvailable ? forgetNetwork : () => {},
    fetchNetworkStatus: isConnectorAvailable ? fetchNetworkStatus : () => {},
    hasPasswordSecurity,
  };
}
