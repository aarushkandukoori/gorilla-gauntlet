/* wikidata.js — pull public height / mass / occupation for any person from Wikidata,
 * then map occupations onto a fight-profile archetype. Uses the public MediaWiki API
 * with origin=* so it works from any host (including file://).
 */
(function (root) {
  'use strict';
  const API = 'https://www.wikidata.org/w/api.php';
  const UNIT_TO_M = { Q11573: 1, Q174728: 0.01, Q3710: 0.3048, Q218593: 0.0254, Q174789: 0.001 };
  const UNIT_TO_KG = { Q11570: 1, Q100995: 0.45359237, Q41803: 0.001, Q41863: 6.35029 };

  async function getJSON(params) {
    const url = API + '?' + new URLSearchParams(Object.assign({ format: 'json', origin: '*' }, params));
    const r = await fetch(url);
    if (!r.ok) throw new Error('Wikidata HTTP ' + r.status);
    return r.json();
  }

  async function search(q) {
    const j = await getJSON({ action: 'wbsearchentities', search: q, language: 'en', type: 'item', limit: 8 });
    return (j.search || []).map(x => ({ id: x.id, label: x.label, description: x.description || '' }));
  }

  function quantity(claims, prop, unitTable) {
    const arr = claims[prop];
    if (!arr) return null;
    // prefer preferred rank, then most recent statement
    const sorted = arr.slice().sort((a, b) => (b.rank === 'preferred') - (a.rank === 'preferred'));
    for (const c of sorted) {
      const v = c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value;
      if (!v || v.amount == null) continue;
      const unit = (v.unit || '').split('/').pop();
      const k = unitTable[unit];
      if (k == null) continue;
      return parseFloat(v.amount) * k;
    }
    return null;
  }

  async function load(id) {
    const j = await getJSON({ action: 'wbgetentities', ids: id, props: 'claims|labels|descriptions', languages: 'en' });
    const e = j.entities && j.entities[id];
    if (!e) throw new Error('No entity ' + id);
    const claims = e.claims || {};
    const heightM = quantity(claims, 'P2048', UNIT_TO_M);
    const massKg = quantity(claims, 'P2067', UNIT_TO_KG);
    const isHuman = (claims.P31 || []).some(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value.id === 'Q5');
    const occIds = (claims.P106 || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value.id).filter(Boolean).slice(0, 12);
    const sportIds = (claims.P641 || []).map(c => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value.id).filter(Boolean).slice(0, 6);
    let occupations = [];
    const ids = occIds.concat(sportIds);
    if (ids.length) {
      const lj = await getJSON({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'en' });
      occupations = ids.map(i => lj.entities && lj.entities[i] && lj.entities[i].labels && lj.entities[i].labels.en && lj.entities[i].labels.en.value).filter(Boolean);
    }
    return {
      id, name: (e.labels && e.labels.en && e.labels.en.value) || id,
      description: (e.descriptions && e.descriptions.en && e.descriptions.en.value) || '',
      heightM, massKg, isHuman, occupations,
    };
  }

  // occupation labels → archetype key (see roster.ARCHETYPES)
  function archetypeFor(occupations) {
    const s = occupations.join(' | ').toLowerCase();
    const has = (...ws) => ws.some(w => s.includes(w));
    if (has('strongman', 'strength athlete')) return 'strongman';
    if (has('bodybuild', 'powerlift', 'weightlift')) return 'lifter';
    if (has('mixed martial', 'mma')) return 'mma';
    if (has('wrestl', 'judo', 'jiu-jitsu', 'jujitsu', 'sambo', 'grappl', 'sumo')) return 'grappler';
    if (has('box', 'kickbox', 'muay thai', 'karate', 'taekwondo', 'martial art')) return 'striker';
    if (has('american football', 'rugby', 'ice hockey', 'gridiron', 'lacrosse')) return 'contact';
    if (has('basketball', 'sprinter', 'athlete', 'football', 'soccer', 'tennis', 'swimmer', 'cyclist', 'runner', 'baseball', 'volleyball', 'gymnast', 'rower', 'decathl', 'track and field', 'sport')) return 'athlete';
    return 'untrained';
  }

  root.Wikidata = { search, load, archetypeFor };
})(window);
