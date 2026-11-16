"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {classifyTask}=require("../task-router");
test("accepts an explicit coding classification",()=>assert.equal(classifyTask('prefix {"type":"coding"} trailing'),"coding"));
test("accepts an explicit chat classification",()=>assert.equal(classifyTask({type:"chat"}),"chat"));
test("rejects missing or ambiguous classifications",()=>{for(const value of ["not json",{type:"other"},{type:"coding",actions:[]},null])assert.throws(()=>classifyTask(value));});
