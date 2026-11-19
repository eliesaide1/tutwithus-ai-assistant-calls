import { AxiosError, AxiosHeaders, type AxiosAdapter } from 'axios';
import { apiClient } from '../src/interceptors/axiosInterceptors.js';

const fetchAdapter: AxiosAdapter = async (config) => {
  const requestHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    AxiosHeaders.from(config.headers).toJSON(),
  )) {
    if (value !== undefined) {
      requestHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
    }
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (config.signal?.aborted) {
    controller.abort();
  } else {
    config.signal?.addEventListener?.('abort', abort);
  }
  let response: Response;
  try {
    response = await fetch(config.url ?? '', {
      method: config.method?.toUpperCase(),
      credentials: config.withCredentials ? 'include' : 'same-origin',
      headers: requestHeaders,
      body: config.data,
      signal: controller.signal,
    });
  } finally {
    config.signal?.removeEventListener?.('abort', abort);
  }
  let responseData: unknown;

  if (typeof response.text === 'function') {
    const text = await response.text();
    try {
      responseData = JSON.parse(text) as unknown;
    } catch {
      responseData = text;
    }
  } else if (typeof response.json === 'function') {
    responseData = await response.json();
  }

  const responseHeaders =
    response.headers && typeof response.headers.entries === 'function'
      ? Object.fromEntries(response.headers.entries())
      : {};
  const axiosResponse = {
    data: responseData,
    status: response.status,
    statusText: response.statusText ?? '',
    headers: AxiosHeaders.from(responseHeaders),
    config,
    request: undefined,
  };
  if (!config.validateStatus || config.validateStatus(response.status)) {
    return axiosResponse;
  }
  throw new AxiosError(
    `Request failed with status code ${response.status}`,
    response.status >= 500
      ? AxiosError.ERR_BAD_RESPONSE
      : AxiosError.ERR_BAD_REQUEST,
    config,
    undefined,
    axiosResponse,
  );
};

export function useFetchBackedApiClient() {
  apiClient.defaults.adapter = fetchAdapter;
}

export function resetApiClientAdapter() {
  apiClient.defaults.adapter = 'fetch';
}
