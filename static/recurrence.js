/* Weekly recurrence: pure functions, no DOM, no FullCalendar.
 *
 * A series is
 *   {id, title, description, tags[], weekdays[], startTime "HH:MM", endTime "HH:MM",
 *    from "YYYY-MM-DD", until "YYYY-MM-DD" | null, exceptions: {}}
 * weekdays use the JavaScript convention: 0 = Sunday, 1 = Monday ... 6 = Saturday.
 * endTime "24:00" (or any endTime <= startTime) ends on the next day.
 *
 * exceptions are keyed by the ORIGINAL date of the occurrence:
 *   {"YYYY-MM-DD": {cancelled?, start?, end?, title?, description?, results?, status?, tags?}}
 * start/end are local datetimes "YYYY-MM-DDTHH:MM". Exceptions whose date is no longer a
 * valid occurrence (outside from..until, or on a weekday that was removed) are kept in the
 * data but not shown, so shortening `until` and extending it again loses nothing.
 */
(function (root) {
  "use strict";

  function parseDate(s) {            // "YYYY-MM-DD" -> UTC midnight Date (no DST surprises)
    const [y, m, d] = s.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  function fmtDate(d) {
    return d.toISOString().slice(0, 10);
  }
  function addDays(s, n) {
    const d = parseDate(s);
    d.setUTCDate(d.getUTCDate() + n);
    return fmtDate(d);
  }
  function weekday(s) {
    return parseDate(s).getUTCDay();
  }

  function isOccurrenceDate(series, date) {
    if (date < series.from) return false;
    if (series.until && date > series.until) return false;
    return (series.weekdays || []).indexOf(weekday(date)) !== -1;
  }

  function defaultStart(series, date) {
    return date + "T" + series.startTime;
  }
  function defaultEnd(series, date) {
    const end = series.endTime;
    if (end === "24:00" || end <= series.startTime) {
      return addDays(date, 1) + "T" + (end === "24:00" ? "00:00" : end);
    }
    return date + "T" + end;
  }

  /* One occurrence, with its exception applied. null if cancelled or not a valid date. */
  function occurrence(series, date) {
    if (!isOccurrenceDate(series, date)) return null;
    const ex = (series.exceptions || {})[date] || {};
    if (ex.cancelled) return null;
    const pick = (k, base) => (ex[k] !== undefined ? ex[k] : base);
    return {
      id: series.id + "::" + date,
      seriesId: series.id,
      date: date,                                   // original date, the exception key
      start: pick("start", defaultStart(series, date)),
      end: pick("end", defaultEnd(series, date)),
      title: pick("title", series.title || ""),
      description: pick("description", series.description || ""),
      results: pick("results", ""),
      status: pick("status", null),
      tags: pick("tags", series.tags || []),
      moved: ex.start !== undefined || ex.end !== undefined,
      edited: Object.keys(ex).length > 0,
    };
  }

  /* All occurrences overlapping [rangeStart, rangeEnd), both "YYYY-MM-DD".
   * Iterates the original dates inside the range, then adds exceptions that were
   * moved INTO the range from an original date outside it. */
  function expandSeries(series, rangeStart, rangeEnd) {
    const out = [];
    const seen = {};
    const lo = series.from > rangeStart ? series.from : rangeStart;
    // one day of slack before the range: an occurrence ending after midnight
    for (let d = addDays(lo, -1); d < rangeEnd; d = addDays(d, 1)) {
      if (series.until && d > series.until) break;
      const occ = occurrence(series, d);
      if (occ) { out.push(occ); seen[d] = true; }
    }
    for (const d of Object.keys(series.exceptions || {})) {
      if (seen[d]) continue;
      const ex = series.exceptions[d];
      if (ex.start === undefined && ex.end === undefined) continue;
      const occ = occurrence(series, d);
      if (occ) out.push(occ);
    }
    const startBound = rangeStart + "T00:00";
    const endBound = rangeEnd + "T00:00";
    return out
      .filter((o) => o.end > startBound && o.start < endBound)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  function expandAll(seriesList, rangeStart, rangeEnd) {
    let out = [];
    for (const s of seriesList || []) out = out.concat(expandSeries(s, rangeStart, rangeEnd));
    return out;
  }

  /* Write a per-date override without mutating the input. Fields equal to the series
   * default are dropped, so later edits of the whole series still reach this date. */
  function withException(series, date, patch) {
    const base = {
      start: defaultStart(series, date),
      end: defaultEnd(series, date),
      title: series.title || "",
      description: series.description || "",
      results: "",
      status: null,
      tags: series.tags || [],
    };
    const prev = (series.exceptions || {})[date] || {};
    const merged = Object.assign({}, prev, patch);
    const ex = {};
    for (const k of Object.keys(merged)) {
      if (k === "cancelled") { if (merged.cancelled) ex.cancelled = true; continue; }
      const same = k === "tags"
        ? JSON.stringify(merged[k] || []) === JSON.stringify(base.tags)
        : merged[k] === base[k];
      if (!same) ex[k] = merged[k];
    }
    const exceptions = Object.assign({}, series.exceptions || {});
    if (Object.keys(ex).length) exceptions[date] = ex; else delete exceptions[date];
    return Object.assign({}, series, { exceptions: exceptions });
  }

  const api = { parseDate, fmtDate, addDays, weekday, isOccurrenceDate, occurrence,
                expandSeries, expandAll, withException, defaultStart, defaultEnd };
  root.Recurrence = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
