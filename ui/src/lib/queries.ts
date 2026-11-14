import { useQuery } from "@tanstack/react-query";
import { api } from "./api";

export const queryKeys = {
  status: ["status"] as const,
  experiments: ["experiments"] as const,
  coverage: ["coverage"] as const,
  dataset: ["dataset"] as const,
  manifests: ["manifests"] as const,
  series: (start: string, end: string) => ["series", start, end] as const,
};

export function useStatus() {
  return useQuery({
    queryKey: queryKeys.status,
    queryFn: ({ signal }) => api.status(signal),
    staleTime: 30_000,
  });
}

export function useExperiments() {
  return useQuery({
    queryKey: queryKeys.experiments,
    queryFn: ({ signal }) => api.experiments(signal),
    staleTime: 60_000,
  });
}

export function useCoverage() {
  return useQuery({
    queryKey: queryKeys.coverage,
    queryFn: ({ signal }) => api.coverage(signal),
    staleTime: 60_000,
  });
}

export function useDataset() {
  return useQuery({
    queryKey: queryKeys.dataset,
    queryFn: ({ signal }) => api.dataset(signal),
    staleTime: 60_000,
  });
}

export function useManifests() {
  return useQuery({
    queryKey: queryKeys.manifests,
    queryFn: ({ signal }) => api.manifests(signal),
    staleTime: 60_000,
  });
}

export function useSeries(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.series(start, end),
    queryFn: ({ signal }) => api.series(start, end, signal),
    staleTime: 60_000,
    enabled,
  });
}