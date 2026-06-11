import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ToastProvider } from "./components/Toast";
import "./index.css";

// TanStack's default networkMode "online" PAUSES queries/mutations when the
// onlineManager flags offline, so neither the service worker's NetworkFirst
// cache (offline reads) nor the api() client's navigator.onLine write guard
// (localized fail-fast, spec §8: no offline mutation queue) would ever run.
// offlineFirst: the first query attempt always fires (reaching the SW cache);
// only retries pause. always: mutationFn always runs so the guard throws.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "offlineFirst" },
    mutations: { networkMode: "always" },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </QueryClientProvider>
  </StrictMode>,
);
