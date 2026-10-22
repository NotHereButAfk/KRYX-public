import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canPlayWithAds,installSponsorBlockCheck} from '../src/ui/SponsorAvailability.js';
assert.equal(canPlayWithAds(),true);installSponsorBlockCheck();assert.equal(canPlayWithAds(),true);
for(const path of ['index.html','public/community.html'])assert.doesNotMatch(readFileSync(path,'utf8'),/adsbygoogle|acceptable\.a-ads|has-top-ad|sponsor-block-warning/);
assert.doesNotMatch(readFileSync('src/main.js','utf8'),/installInlineAds|installSponsorBlockCheck/);
console.log('Ads paused: no provider embeds, ad layout, startup checks, or play restriction.');
