import { arrayOf, text, firstPresent, hostOf } from './_util.mjs';

function postingFromJob(job, context) {
  return {
    title: text(job.title ?? job.name),
    url: firstPresent(job.url, job.link),
    company: firstPresent(job.company?.name, job.company_name, context.company, context.name),
    location: text(job.location?.city ?? job.location?.name ?? job.location),
    description: String(job.description ?? job.contents ?? ''),
    postedAt: firstPresent(job.published_date, job.published_at, job.updated),
    externalId: text(job.id ?? job.external_feed_id ?? job.url),
  };
}

export default {
  id: 'weworkremotely',
  hosts: ['weworkremotely.com'],
  keyword: (url) => hostOf(url) === 'weworkremotely.com',
  detect: () => ({ url: 'https://weworkremotely.com/remote-jobs.json' }),
  async fetch(entry, ctx) {
    const data = await ctx.fetchJson(this.detect(entry).url, { redirect: 'error' });
    if (!Array.isArray(data)) return [];
    return data.filter((job) => job && job.url).map((job) => postingFromJob(job, entry));
  },
};