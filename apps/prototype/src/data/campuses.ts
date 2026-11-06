// The 23 campuses, mirroring packages/db/src/seed.ts (name and short code).
// internal_tier is deliberately absent: the spec says it is never shown (§2).
export interface Campus { code: string; sym: string; city: string; name: string; domain: string; domains?: string[] }

export const CAMPUSES: Campus[] = [
  { code: "IITB", sym: "B", city: "Bombay", name: "IIT Bombay", domain: "iitb.ac.in" },
  { code: "IITD", sym: "D", city: "Delhi", name: "IIT Delhi", domain: "iitd.ac.in" },
  { code: "IITM", sym: "M", city: "Madras", name: "IIT Madras", domain: "smail.iitm.ac.in", domains: ["smail.iitm.ac.in", "iitm.ac.in"] },
  { code: "IITK", sym: "K", city: "Kanpur", name: "IIT Kanpur", domain: "iitk.ac.in" },
  { code: "IITKGP", sym: "KGP", city: "Kharagpur", name: "IIT Kharagpur", domain: "kgpian.iitkgp.ac.in", domains: ["kgpian.iitkgp.ac.in", "iitkgp.ac.in"] },
  { code: "IITR", sym: "R", city: "Roorkee", name: "IIT Roorkee", domain: "iitr.ac.in" },
  { code: "IITG", sym: "G", city: "Guwahati", name: "IIT Guwahati", domain: "iitg.ac.in" },
  { code: "IITH", sym: "H", city: "Hyderabad", name: "IIT Hyderabad", domain: "iith.ac.in" },
  { code: "IITBHU", sym: "BHU", city: "Varanasi", name: "IIT (BHU) Varanasi", domain: "itbhu.ac.in", domains: ["itbhu.ac.in", "iitbhu.ac.in"] },
  { code: "IITI", sym: "I", city: "Indore", name: "IIT Indore", domain: "iiti.ac.in" },
  { code: "IITGN", sym: "GN", city: "Gandhinagar", name: "IIT Gandhinagar", domain: "iitgn.ac.in" },
  { code: "IITRPR", sym: "RPR", city: "Ropar", name: "IIT Ropar", domain: "iitrpr.ac.in" },
  { code: "IITMandi", sym: "MD", city: "Mandi", name: "IIT Mandi", domain: "iitmandi.ac.in" },
  { code: "IITJ", sym: "J", city: "Jodhpur", name: "IIT Jodhpur", domain: "iitj.ac.in" },
  { code: "IITP", sym: "P", city: "Patna", name: "IIT Patna", domain: "iitp.ac.in" },
  { code: "IITBBS", sym: "BBS", city: "Bhubaneswar", name: "IIT Bhubaneswar", domain: "iitbbs.ac.in" },
  { code: "IITISM", sym: "ISM", city: "Dhanbad", name: "IIT (ISM) Dhanbad", domain: "iitism.ac.in" },
  { code: "IITTP", sym: "TP", city: "Tirupati", name: "IIT Tirupati", domain: "iittp.ac.in" },
  { code: "IITPKD", sym: "PKD", city: "Palakkad", name: "IIT Palakkad", domain: "iitpkd.ac.in" },
  { code: "IITBH", sym: "BH", city: "Bhilai", name: "IIT Bhilai", domain: "iitbhilai.ac.in" },
  { code: "IITGOA", sym: "GOA", city: "Goa", name: "IIT Goa", domain: "iitgoa.ac.in" },
  { code: "IITJMU", sym: "JMU", city: "Jammu", name: "IIT Jammu", domain: "iitjammu.ac.in" },
  { code: "IITDH", sym: "DH", city: "Dharwad", name: "IIT Dharwad", domain: "iitdh.ac.in" },
];
export const campus = (code: string): Campus => CAMPUSES.find((c) => c.code === code) ?? CAMPUSES[0]!;

/** The campus an email address belongs to, by the seeded domains (the API makes the binding decision). */
export const campusForEmail = (email: string): Campus | undefined => {
  const domain = email.toLowerCase().split("@")[1] ?? "";
  return CAMPUSES.find((c) => (c.domains ?? [c.domain]).includes(domain));
};
