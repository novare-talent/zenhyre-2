import { createDb, schema } from "./index";
const IITS: Array<[string, string, string[], number]> = [
  ["IIT Bombay", "IITB", ["iitb.ac.in"], 1], ["IIT Delhi", "IITD", ["iitd.ac.in"], 1], ["IIT Madras", "IITM", ["smail.iitm.ac.in", "iitm.ac.in"], 1],
  ["IIT Kanpur", "IITK", ["iitk.ac.in"], 1], ["IIT Kharagpur", "IITKGP", ["kgpian.iitkgp.ac.in", "iitkgp.ac.in"], 1], ["IIT Roorkee", "IITR", ["iitr.ac.in"], 1],
  ["IIT Guwahati", "IITG", ["iitg.ac.in"], 1], ["IIT Hyderabad", "IITH", ["iith.ac.in"], 2], ["IIT (BHU) Varanasi", "IITBHU", ["itbhu.ac.in", "iitbhu.ac.in"], 2],
  ["IIT Indore", "IITI", ["iiti.ac.in"], 2], ["IIT Gandhinagar", "IITGN", ["iitgn.ac.in"], 2], ["IIT Ropar", "IITRPR", ["iitrpr.ac.in"], 2],
  ["IIT Mandi", "IITMandi", ["iitmandi.ac.in"], 2], ["IIT Jodhpur", "IITJ", ["iitj.ac.in"], 2], ["IIT Patna", "IITP", ["iitp.ac.in"], 2],
  ["IIT Bhubaneswar", "IITBBS", ["iitbbs.ac.in"], 2], ["IIT (ISM) Dhanbad", "IITISM", ["iitism.ac.in"], 2], ["IIT Tirupati", "IITTP", ["iittp.ac.in"], 3],
  ["IIT Palakkad", "IITPKD", ["iitpkd.ac.in"], 3], ["IIT Bhilai", "IITBH", ["iitbhilai.ac.in"], 3], ["IIT Goa", "IITGOA", ["iitgoa.ac.in"], 3],
  ["IIT Jammu", "IITJMU", ["iitjammu.ac.in"], 3], ["IIT Dharwad", "IITDH", ["iitdh.ac.in"], 3],
];
const { db, close } = createDb();
for (const [name, shortCode, emailDomains, internalTier] of IITS)
  await db.insert(schema.campus).values({ name, shortCode, emailDomains, internalTier }).onConflictDoNothing();
await close();
console.log("seeded", IITS.length, "campuses");
