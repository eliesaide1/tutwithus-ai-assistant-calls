import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export type ApiRequestConfig = AxiosRequestConfig & {
  bearerToken?: string;
};

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly requestId?: string,
    readonly responseData?: unknown,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

function getErrorDetails(response: AxiosResponse<unknown> | undefined) {
  const data = response?.data;
  const envelope =
    typeof data === 'object' &&
    data !== null &&
    'error' in data &&
    typeof data.error === 'object' &&
    data.error !== null
      ? data.error
      : null;
  const message =
    envelope && 'message' in envelope && typeof envelope.message === 'string'
      ? envelope.message
      : undefined;
  const code =
    envelope && 'code' in envelope && typeof envelope.code === 'string'
      ? envelope.code
      : undefined;
  const requestId =
    envelope &&
    'requestId' in envelope &&
    typeof envelope.requestId === 'string'
      ? envelope.requestId
      : response?.headers['x-request-id'];

  return {
    message:
      message ??
      (response
        ? `The API request failed with HTTP ${response.status}.`
        : 'The API could not be reached.'),
    code,
    requestId: typeof requestId === 'string' ? requestId : undefined,
    responseData: data,
  };
}

export const apiClient = axios.create({
  adapter: 'fetch',
  baseURL: API_BASE_URL,
  withCredentials: true,
});

apiClient.interceptors.request.use((config) => {
  if (!config.headers.has('Accept')) {
    config.headers.set('Accept', 'application/json');
  }
  const { bearerToken } = config as typeof config & {
    bearerToken?: string;
  };
  if (bearerToken) {
    config.headers.set('Authorization', `Bearer ${bearerToken}`);
    delete (config as typeof config & { bearerToken?: string }).bearerToken;
  }
  if (
    config.data !== undefined &&
    !(typeof FormData !== 'undefined' && config.data instanceof FormData) &&
    !config.headers.has('Content-Type')
  ) {
    config.headers.set('Content-Type', 'application/json');
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (cause: unknown) => {
    if (!axios.isAxiosError(cause)) {
      return Promise.reject(cause);
    }

    const details = getErrorDetails(cause.response);
    return Promise.reject(
      new ApiClientError(
        details.message,
        cause.response?.status,
        details.code,
        details.requestId,
        details.responseData,
      ),
    );
  },
);

export function apiRequest<T>(
  config: ApiRequestConfig,
): Promise<AxiosResponse<T>> {
  return apiClient.request<T>(config);
}
