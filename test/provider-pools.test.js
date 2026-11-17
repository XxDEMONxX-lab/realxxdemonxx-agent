"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {normalizeFreePool,buildProviderCandidates,isRetryableProviderError,isProviderQuotaError}=require("../provider-pools");
test("free model pools require one to six unique bounded IDs",()=>{
 assert.deepEqual(normalizeFreePool(["model-a","model-b"]),["model-a","model-b"]);
 for(const pool of [[],Array(7).fill("x"),["x","x"],["bad model"],[null]])assert.throws(()=>normalizeFreePool(pool));
});
test("provider candidates try the selected model and configured free pool before provider fallbacks",()=>{
 const values=buildProviderCandidates("gemini","main",["groq"],{groq:"fallback"},{gemini:["free-a","free-b"],groq:["free-c"]});
 assert.deepEqual(values,[{id:"gemini",model:"main"},{id:"gemini",model:"free-a"},{id:"gemini",model:"free-b"},{id:"groq",model:"free-c"}]);
});
test("provider candidate construction deduplicates and honors disabled failover",()=>{
 assert.deepEqual(buildProviderCandidates("p","m",["p","q"],{q:"m"},{p:["m","p2"]},false),[{id:"p",model:"m"}]);
});
test("provider-wide quota errors are distinguished from transient model failures",()=>{
 assert.equal(isProviderQuotaError(new Error("HTTP 429: quota exceeded")),true);
 assert.equal(isProviderQuotaError(new Error("RESOURCE_EXHAUSTED")),true);
 assert.equal(isProviderQuotaError(new Error("HTTP 503: unavailable")),false);
});
test("only rate limits, transient server failures and network timeouts trigger automatic failover",()=>{
 for(const message of ["HTTP 429: quota exceeded","HTTP 503: unavailable","Request timeout","fetch failed","ECONNRESET"])assert.equal(isRetryableProviderError(new Error(message)),true);
 for(const message of ["HTTP 400: invalid request","HTTP 401: bad key","HTTP 404: model missing"])assert.equal(isRetryableProviderError(new Error(message)),false);
});
