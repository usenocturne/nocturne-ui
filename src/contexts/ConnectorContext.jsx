import { createContext, useContext, useState, useEffect } from "react";

const API_BASE = "http://172.16.42.1:20574";

let restoreSent = false;

const ConnectorContext = createContext({
  isConnectorAvailable: false,
  isLoading: true,
  connectorInfo: {},
});

export function ConnectorProvider({ children }) {
  const [isConnectorAvailable, setIsConnectorAvailable] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [connectorInfo, setConnectorInfo] = useState({});

  useEffect(() => {
    let intervalId;
    const POLL_INTERVAL = 15000;
    const POLL_DURATION = 180000;
    const startTime = Date.now();

    let connectorFound = false;

    const checkConnectorAvailability = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      try {
        const response = await fetch(`${API_BASE}/info`, {
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        const data = await response.json().catch(() => ({}));
        if (response.ok) {
          setConnectorInfo(data);
          setIsConnectorAvailable(true);
          connectorFound = true;
          clearInterval(intervalId);

          if (!restoreSent && typeof localStorage !== "undefined") {
            restoreSent = true;
            try {
              const networkStatusResponse = await fetch(`${API_BASE}/network`);
              let isAlreadyConnected = false;

              if (networkStatusResponse.ok) {
                const networkStatus = await networkStatusResponse.json();
                isAlreadyConnected =
                  networkStatus && Object.keys(networkStatus).length > 0;
              }

              if (!isAlreadyConnected) {
                const networksJson = localStorage.getItem("savedWifiNetworks");
                if (networksJson) {
                  const networks = JSON.parse(networksJson);
                  if (Array.isArray(networks) && networks.length > 0) {
                    const restoreResponse = await fetch(
                      `${API_BASE}/network/restore`,
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                        },
                        body: JSON.stringify(networks),
                      },
                    );

                    if (restoreResponse.ok) {
                      const lastId = localStorage.getItem(
                        "lastConnectedWifiNetworkId",
                      );
                      if (lastId) {
                        fetch(`${API_BASE}/network/select/${lastId}`, {
                          method: "POST",
                        }).catch((err) => {
                          console.error(
                            "Failed to select last connected Wi-Fi network",
                            err,
                          );
                        });
                      }
                    }
                  }
                }
              }
            } catch (err) {
              console.error(
                "Error processing saved Wi-Fi networks from localStorage",
                err,
              );
            }
          }
        } else {
          setIsConnectorAvailable(false);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        setIsConnectorAvailable(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkConnectorAvailability();

    intervalId = setInterval(() => {
      const elapsed = Date.now() - startTime;
      if (elapsed >= POLL_DURATION || connectorFound) {
        clearInterval(intervalId);
        return;
      }
      checkConnectorAvailability();
    }, POLL_INTERVAL);

    return () => clearInterval(intervalId);
  }, []);

  return (
    <ConnectorContext.Provider
      value={{ isConnectorAvailable, isLoading, connectorInfo }}
    >
      {children}
    </ConnectorContext.Provider>
  );
}

export function useConnector() {
  return useContext(ConnectorContext);
}
