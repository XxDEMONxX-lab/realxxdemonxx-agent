"use strict";
const {parseObject}=require("./coding-team");
function classifyTask(raw){
 const value=typeof raw==="string"?parseObject(raw,"Task router"):raw;
 if(!value||typeof value!=="object"||Array.isArray(value)||!["coding","chat"].includes(value.type))throw Error('Task router must return {"type":"coding"} or {"type":"chat"}');
 return value.type;
}
module.exports={classifyTask};
