export default {
  id: 'stubboard',
  hosts: ['stub.example'],
  keyword: (url) => /stub\.example/i.test(String(url ?? '')),
  detect: (entry) => (entry?.url ? { url: entry.url } : null),
  async fetch(entry) {
    if (entry?.board === 'empty') return [];
    if (entry?.board === 'malformed') return { notAnArray: true };
    return [
      { title: 'Engineer One', url: 'https://stub.example/jobs/1', company: 'Stub Co', location: 'Remote', postedAt: '2026-10-01' },
      { title: 'Engineer Two', url: 'https://stub.example/jobs/2', company: 'Stub Co', location: 'London' },
      { title: 'Suspicious intern', url: 'https://stub.example/jobs/3', company: 'Stub Co', location: 'Remote' },
    ];
  },
};