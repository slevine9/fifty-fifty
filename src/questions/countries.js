// Shared country data (REST Countries, free, no key). Used by the flags and versus sources.
const { getJson } = require('./util');

let cache = null;

async function getCountries() {
  if (cache && Date.now() - cache.at < 60 * 60 * 1000) return cache.list;
  const data = await getJson('https://restcountries.com/v3.1/all?fields=name,flags,region,population,area,independent,cca2');
  const list = data
    .filter((c) => c.independent && c.name?.common && c.flags?.svg && c.population > 0 && c.area > 0)
    .map((c) => ({ name: c.name.common, cca2: c.cca2, region: c.region, pop: c.population, area: c.area, flag: c.flags.svg }))
    .sort((a, b) => b.pop - a.pop);
  list.forEach((c, i) => { c.rank = i; }); // 0 = most populous, a decent proxy for "how famous"
  if (list.length < 30) throw new Error('REST Countries returned too few countries');
  cache = { at: Date.now(), list };
  return list;
}

module.exports = { getCountries };
