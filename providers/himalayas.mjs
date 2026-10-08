import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://himalayas.app/jobs/api';

function isoFromUnixSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return '';
  // pubDate arrives as unix epoch seconds (13-digit ms timestamps also accepted).
  const ms = String(value).length >= 13 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function postingFromJob(job, context) {
  const slug = text(job.slug);
  const restrictions = Array.isArray(job.locationRestrictions) ? job.locationRestrictions.join(', ') : '';
  return {
    title: firstPresent(job.title, job.role_title),
    url: firstPresent(job.applicationLink, job.url, slug ? `https://himalayas.app/jobs/${slug}` : null),
    company: firstPresent(job.companyName, job.company_name, job.company?.name, context.company, context.name),
    location: text(restrictions || job.location || job.locations?.[0]?.text),
    description: String(job.description ?? ''),
    postedAt: firstPresent(isoFromUnixSeconds(job.pubDate), job.published_date, job.published_at, job.posted_at),
    externalId: text(job.guid ?? job.id ?? slug),
  };
}

export default {
  id: 'himalayas',
  hosts: ['himalayas.app'],
  keyword: (url) => hostOf(url).endsWith('himalayas.app'),
  detect: (entry) => {
    const endpoint = firstPresent(entry.endpoint, entry.key);
    return { url: endpoint ? (endpoint.startsWith('http') ? endpoint : `https://${endpoint}`) : API_BASE };
  },
  async fetch(entry, ctx) {
    const seed = this.detect(entry);
    if (!seed) return [];
    const data = await ctx.fetchJson(seed.url, { redirect: 'error' });
    if (!data) return [];
    const records = Array.isArray(data) ? data : arrayOf(data.jobs ?? data.data);
    return records.map((job) => postingFromJob(job, entry));
  },
};