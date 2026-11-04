import test from "node:test";
import assert from "node:assert/strict";
import {buildWorkflowPlan,listWorkflows} from "../src/workflows.js";

test("workflow catalog exposes supported engineering workflows",()=>{
 const items=listWorkflows();
 assert.ok(items.length>=8);
 assert.ok(items.some(item=>item.id==="bugfix"));
});

test("workflow plan contains task, steps and safety gates",()=>{
 const plan=JSON.parse(buildWorkflowPlan("security","Review API authentication"));
 assert.equal(plan.task,"Review API authentication");
 assert.ok(plan.steps.length>=5);
 assert.ok(plan.gates.some(gate=>gate.includes("credentials")));
 assert.throws(()=>buildWorkflowPlan("unknown"));
});
