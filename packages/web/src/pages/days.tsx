import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { DaySummary } from "@fx/core/api";
import { useApi } from "../providers";
import { directionArrow, directionLabel, formatDay, formatMonth, monthCells, todaySast } from "../format";
import { AssetMeta, DirectionChip, ErrorNote, LoadingBlock, MiniMark, PageHeader, Spinner, StatusPill } from "../ui";

export function DaysPage() {
  const api = useApi();
  const today = todaySast();
  const [cursor, setCursor] = useState(() => {
    const [year, month] = today.split("-").map(Number);
    return { year: year ?? 2026, month: month ?? 10 };
  });
  const query = useInfiniteQuery({
    queryKey: ["days"],
    queryFn: ({ pageParam }) => api.listDays({ limit: 30, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const days = useMemo(() => query.data?.pages.flatMap((page) => page.days) ?? [], [query.data]);
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const morning = byDate.get(today) ?? days[0];
  const sentinel = useRef<HTMLDivElement>(null);
  const fetching = useRef(false);
  fetching.current = query.isFetchingNextPage;

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !query.hasNextPage) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !fetching.current) void query.fetchNextPage();
      },
      { rootMargin: "240px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [query.hasNextPage, query.fetchNextPage]);

  useEffect(() => {
    if (!query.hasNextPage || query.isFetchingNextPage) return;
    const oldest = days[days.length - 1]?.date;
    if (!oldest) return;
    const monthStart = `${cursor.year}-${String(cursor.month).padStart(2, "0")}-01`;
    if (monthStart < oldest) void query.fetchNextPage();
  }, [cursor, days, query.hasNextPage, query.isFetchingNextPage, query.fetchNextPage]);

  if (query.isLoading) return <LoadingBlock label="Loading days" />;
  if (query.isError) return <ErrorNote error={query.error} onRetry={() => void query.refetch()} />;

  const cells = monthCells(cursor.year, cursor.month);
  const shiftMonth = (dir: -1 | 1) => {
    const date = new Date(Date.UTC(cursor.year, cursor.month - 1 + dir, 1));
    setCursor({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 });
  };

  return (
    <>
      <PageHeader title="Days" kicker />
      <div className="days-layout">
        {morning ? <MorningCard day={morning} today={today} /> : <section className="card">No runs yet.</section>}
        <section className="card calendar-card">
          <div className="cal-head">
            <button type="button" className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <h2>{formatMonth(cursor.year, cursor.month)}</h2>
            <button type="button" className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <div className="cal-dow" aria-hidden="true">
            {["MON", "TUE", "WED", "THU", "FRI"].map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>
          <div className="cal-grid">
            {cells.map((cell, index) =>
              cell ? (
                <CalendarCell key={cell.date} date={cell.date} day={cell.day} summary={byDate.get(cell.date)} today={today} />
              ) : (
                <div key={`blank-${index}`} className="cal-blank" />
              ),
            )}
          </div>
          <div className="legend">
            <span><MiniMark direction="long" /> Long</span>
            <span><MiniMark direction="short" /> Short</span>
            <span><MiniMark direction="stand_aside" /> Stand aside</span>
            <span><MiniMark failed /> Failed</span>
            <span className="legend-note">Left Nasdaq · right Gold</span>
          </div>
        </section>
        <section className="day-list">
          <h2>All days</h2>
          <div className="stack">
            {days.map((day) => (
              <DayRow key={day.date} day={day} />
            ))}
          </div>
          {query.hasNextPage ? (
            <button className="load-more" type="button" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? <Spinner /> : null}
              {query.isFetchingNextPage ? "Loading earlier days" : "Load earlier days"}
            </button>
          ) : null}
          <div ref={sentinel} />
        </section>
      </div>
    </>
  );
}

function MorningCard({ day, today }: { day: DaySummary; today: string }) {
  const label = day.date === today ? "This morning" : "Last run";
  return (
    <section className="card morning">
      <div className="card-kicker">
        <span>
          {label} · {formatDay(day.date)} · 09:00 SAST
        </span>
        <StatusPill status={day.status} />
      </div>
      <div className="morning-tiles">
        <MorningTile date={day.date} asset="nasdaq100" name="Nasdaq 100" day={day.assets.nasdaq100} nasdaq />
        <MorningTile date={day.date} asset="gold" name="Gold" day={day.assets.gold} />
      </div>
    </section>
  );
}

function MorningTile({
  date,
  asset,
  name,
  day,
  nasdaq = false,
}: {
  date: string;
  asset: string;
  name: string;
  day: DaySummary["assets"]["nasdaq100"];
  nasdaq?: boolean;
}) {
  const href = day?.ok ? `/r/${asset}/${date}` : `/d/${date}`;
  const direction = day?.direction;
  return (
    <Link className={`asset-tile${nasdaq ? " nasdaq" : ""}`} to={href}>
      <span className="tile-name">{name}</span>
      {day?.ok && direction ? (
        <span className={`direction-lg dir-${direction}`}>
          {directionArrow(direction)} {directionLabel(direction)}
        </span>
      ) : (
        <span className="direction-lg dir-failed">× Failed</span>
      )}
      <AssetMeta grade={day?.grade} confidence={day?.confidence} poor={day?.captureQuality === "poor"} failed={!day?.ok} />
    </Link>
  );
}

function CalendarCell({ date, day, summary, today }: { date: string; day: number; summary?: DaySummary; today: string }) {
  const future = date > today;
  const failed = Boolean(summary && (!summary.assets.nasdaq100?.ok || !summary.assets.gold?.ok || summary.status === "failed"));
  const className = `cal-cell${date === today ? " today" : ""}${failed ? " failed-day" : ""}${future || !summary ? " empty" : ""}`;
  const body = (
    <>
      <span className="day-num">{day}</span>
      {summary ? (
        <span className="cal-chips">
          <MiniMark direction={summary.assets.nasdaq100?.direction} failed={summary.assets.nasdaq100?.ok === false} />
          <MiniMark direction={summary.assets.gold?.direction} failed={summary.assets.gold?.ok === false} />
        </span>
      ) : null}
    </>
  );
  if (future) return <div className={className}>{body}</div>;
  return (
    <Link className={className} to={`/d/${date}`} aria-current={date === today ? "date" : undefined}>
      {body}
    </Link>
  );
}

function DayRow({ day }: { day: DaySummary }) {
  return (
    <Link className="card day-row" to={`/d/${day.date}`}>
      <div className="row-head">
        <strong>{formatDay(day.date)}</strong>
        <StatusPill status={day.status} />
      </div>
      <AssetLine name="Nasdaq 100" asset={day.assets.nasdaq100} />
      <AssetLine name="Gold" asset={day.assets.gold} />
    </Link>
  );
}

function AssetLine({ name, asset }: { name: string; asset: DaySummary["assets"]["gold"] }) {
  return (
    <div className="asset-line">
      <span className="asset-name">{name}</span>
      <DirectionChip direction={asset?.direction} failed={!asset?.ok} />
      <AssetMeta grade={asset?.grade} confidence={asset?.confidence} poor={asset?.captureQuality === "poor"} failed={!asset?.ok} compact />
    </div>
  );
}
