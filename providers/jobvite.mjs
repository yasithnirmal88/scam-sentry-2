import { arrayOf, text, firstPresent, hostOf, hostMatchesSuffix } from './_util.mjs';

function postingFromJob(job, context) {
  return {
    title: text(job.title ?? job.name ?? job.position),
    url: firstPresent(job.url ?? job.requisitionUrl),
    company: firstPresent(job.company ?? job.companyName, context.company, context.name),
    location: text(job.location ?? job.city),
    description: String(job.description ?? ''),
    postedAt: text(job.created_at ?? job.posted_at ?? job.date),
    externalId: text(job.id ?? job.reqId ?? job.url),
  };
}

export default {
  id: 'jobvite',
  hosts: [],
  hostSuffixes: ['jobvite.com'],
  keyword: (url) => hostMatchesSuffix(url, ['jobvite.com']),
  assertEntryAllowed: (entry) => {
    const host = hostOf(entry?.url);
    if (!hostMatchesSuffix(entry?.url, ['jobvite.com'])) {
      throw new Error(`jobvite: url host must be anchored to .jobvite.com, got "${host}"`);
    }
  },
  detect: (entry) => {
    const url = firstPresent(entry.url, entry.board);
    return url ? { url } : null;
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    let url = seed.url;
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    let data;
    try {
      data = await ctx.fetchJson(url, { redirect: 'error' });
    } catch {
      return [];
    }
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.jobs ?? data.requisitions ?? data.value ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};