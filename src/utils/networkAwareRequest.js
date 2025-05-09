import { checkNetworkConnectivity } from './networkChecker';

const LOCAL_URLS = ['172.16.42.1', 'localhost'];
let currentNetworkCheckPromise = null;

function isLocalRequest(url) {
  return LOCAL_URLS.some(localUrl => url.includes(localUrl));
}

export async function waitForNetwork(checkIntervalMs = 1000) {
  if (currentNetworkCheckPromise) {
    return currentNetworkCheckPromise;
  }

  currentNetworkCheckPromise = (async () => {
    let wasOffline = false;
    
    while (true) {
      const status = await checkNetworkConnectivity();
      if (status.isConnected) {
        if (wasOffline) {
          window.dispatchEvent(new CustomEvent('networkRestored'));
        }
        currentNetworkCheckPromise = null;
        return true;
      }
      wasOffline = true;
      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }
  })();

  return currentNetworkCheckPromise;
}

export async function networkAwareRequest(requestFn, { skipNetworkCheck = false } = {}) {
  const getUrl = (request) => {
    if (request instanceof Request) return request.url;
    if (typeof request === 'string') return request;
    return null;
  };

  const url = typeof requestFn === 'function' ? null : getUrl(requestFn);
  
  if (skipNetworkCheck || (url && isLocalRequest(url))) {
    return typeof requestFn === 'function' ? requestFn() : fetch(requestFn);
  }

  await waitForNetwork();
  return typeof requestFn === 'function' ? requestFn() : fetch(requestFn);
}
