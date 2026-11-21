export const activeDevice=(m,uid)=>!!m&&m.schemaVersion===2&&m.uid===uid&&m.role==='device'&&m.authType==='anonymous'&&m.status==='active';
export const deviceStatus=(m,uid)=>activeDevice(m,uid)?'active':m?.status==='revoked'?'revoked':'waiting';
