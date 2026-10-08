import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

const API_BASE = 'https://himalayas.app/jobs.json';

function postingFromJob(job, context) {
  const slug = text(job.slug);
  return {
    title: firstPresent(job.title, job.role_title),
    url: firstPresent(job.url, slug ? `https://himalayas.app/jobs/${slug}` : null),
    company: firstPresent(job.company_name, job.company?.name, context.company, context.name),
    location: text(job.location ?? job.locations?.[0]?.text),
    description: String(job.description ?? ''),
    postedAt: firstPresent(job.published_date, job.published_at, job.posted_at),
    externalId: text(job.id ?? slug),
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
    if (!Array.isArray(data)) return [];
    return data.filter((job) => job && job.url).map((job) => postingFromJob(job, entry));
  },
};