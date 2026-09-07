const endpoint=process.env.RADAR_HEALTH_URL;
if(!endpoint||!/^https:\/\/[a-z0-9.-]+\/health$/.test(endpoint))throw new Error('Configure the scanner health URL');
let result;
for(let attempt=0;attempt<3;attempt++){
 try{const response=await fetch(endpoint,{redirect:'error',signal:AbortSignal.timeout(20_000)});const data=await response.json();result={http:response.status,status:data.status,coverage:data.coverage,delivery:data.delivery,scheduled:data.scheduleEnabled,sending:data.sendingEnabled};if(response.ok&&data.scheduleEnabled&&data.sendingEnabled&&(data.status==='healthy'||data.status==='awaiting_first_schedule')){console.log(JSON.stringify(result));process.exit(0);}}catch{result={status:'unreachable'};}
 if(attempt<2)await new Promise(resolve=>setTimeout(resolve,5000));
}
console.error(JSON.stringify(result));process.exitCode=1;
