import test from 'node:test';
import assert from 'node:assert/strict';
import {createAccessIdentity} from '../../apps/api/src/platform/access-identity.mjs';
import {createLocalJWKSet,exportJWK,generateKeyPair,SignJWT} from 'jose';
test('production identity fails closed without HTTPS, audience or operator allowlist',()=>{
 for(const options of [{},{teamDomain:'http://team.cloudflareaccess.com',audience:'valid_audience_123',allowedDomain:'tzolkin.com'},{teamDomain:'https://evil.example.com',audience:'valid_audience_123',allowedDomain:'tzolkin.com'},{teamDomain:'https://team.cloudflareaccess.com',audience:'short',allowedDomain:'tzolkin.com'},{teamDomain:'https://team.cloudflareaccess.com',audience:'valid_audience_123'}])assert.throws(()=>createAccessIdentity(options));
});
test('production identity verifies signature, issuer, audience, expiry and allowlist',async()=>{
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test';jwk.use='sig';jwk.alg='RS256';const keySet=createLocalJWKSet({keys:[jwk]});
 const identity=createAccessIdentity({teamDomain:'https://team.cloudflareaccess.com',audience:'audience_for_core_123',allowedEmails:'operator@tzolkin.com',keySet});
 const token=claims=>new SignJWT({email:'operator@tzolkin.com',...claims}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('user-1').setIssuer('https://team.cloudflareaccess.com').setAudience('audience_for_core_123').setIssuedAt().setExpirationTime('5m').sign(privateKey);
 assert.deepEqual(await identity.resolve({headers:{'cf-access-jwt-assertion':await token()}}),{subject:'user-1',email:'operator@tzolkin.com'});
 assert.equal(await identity.resolve({headers:{'cf-access-jwt-assertion':await token({email:'outsider@example.com'})}}),null);
 const wrongAud=await new SignJWT({email:'operator@tzolkin.com'}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('user-1').setIssuer('https://team.cloudflareaccess.com').setAudience('other_audience_123').setExpirationTime('5m').sign(privateKey);
 assert.equal(await identity.resolve({headers:{'cf-access-jwt-assertion':wrongAud}}),null);
});
test('production identity rejects absent and malformed assertions without fetching identity keys',async()=>{
 const identity=createAccessIdentity({teamDomain:'https://team.cloudflareaccess.com',audience:'valid_audience_123',allowedEmails:'operator@tzolkin.com'});
 assert.equal(identity.mode,'cloudflare-access');assert.equal(identity.secure,true);assert.equal(await identity.resolve({headers:{}}),null);assert.equal(await identity.resolve({headers:{'cf-access-jwt-assertion':'not-a-jwt'}}),null);
});
