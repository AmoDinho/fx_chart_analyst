import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useApi } from "./providers";

const imageStale = 10 * 60 * 1000;

export function useDays() {
  const api = useApi();
  return useInfiniteQuery({
    queryKey: ["days"],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => api.listDays({ limit: 30, cursor: pageParam }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useDay(date: string) {
  const api = useApi();
  return useQuery({ queryKey: ["day", date], queryFn: () => api.getDay(date), staleTime: imageStale, refetchOnWindowFocus: true });
}

export function useReport(asset: string, date: string) {
  const api = useApi();
  return useQuery({
    queryKey: ["report", asset, date],
    queryFn: () => api.getReport(asset, date),
    staleTime: imageStale,
    refetchOnWindowFocus: true,
  });
}

export function useMarkdown(asset: string, date: string, enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ["markdown", asset, date], queryFn: () => api.getMarkdown(asset, date), enabled });
}

export function useHistory(asset: string, from: string, to: string) {
  const api = useApi();
  return useQuery({ queryKey: ["history", asset, from, to], queryFn: () => api.getHistory(asset, from, to) });
}

export function useRuns(date: string) {
  const api = useApi();
  return useQuery({ queryKey: ["runs", date], queryFn: () => api.getRuns(date) });
}

export function useStatus(enabled: boolean) {
  const api = useApi();
  return useQuery({ queryKey: ["status"], queryFn: () => api.getStatus(), enabled, refetchInterval: 15_000 });
}
