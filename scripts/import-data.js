import {storage} from "../storage.js";
try{await storage.initialize();const count=await storage.importLocal();console.log(`Imported ${count} data documents into Postgres.`);}finally{await storage.close();}
