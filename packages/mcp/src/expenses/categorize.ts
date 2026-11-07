/**
 * Rule table: merchant keywords (and the bank's own category as a fallback)
 * → a proposed Schedule C category. No LLM, no network. Proposals only: the
 * user confirms every row before anything is written.
 */
import type { ScheduleCExpense } from '@1040kit/engine';

export type Proposal = ScheduleCExpense | 'personal' | 'unsure';

interface Rule {
  re: RegExp;
  category: Proposal;
  reason: string;
}

const RULES: Rule[] = [
  // Software & SaaS: Schedule C Part V "other expenses" (list as "Software").
  {
    re: /\b(ADOBE|GITHUB|FIGMA|NOTION|SLACK|ZOOM\.?US|ZOOM VIDEO|DROPBOX|ATLASSIAN|JETBRAINS|MICROSOFT\s*\*?\s*(365|OFFICE)|MSFT|GOOGLE\s*\*?\s*(GSUITE|WORKSPACE|CLOUD)|AWS|AMAZON WEB SERVICES|DIGITALOCEAN|HEROKU|VERCEL|NETLIFY|CLOUDFLARE|OPENAI|ANTHROPIC|CHATGPT|CANVA|CALENDLY|DOCUSIGN|QUICKBOOKS|INTUIT|FRESHBOOKS|XERO|SQUARESPACE|WIX|SHOPIFY|MAILCHIMP|GODADDY|NAMECHEAP|1PASSWORD|LASTPASS)\b/i,
    category: 'other',
    reason:
      'Software / online service subscription (Schedule C Part V, "Software"). Business use only.',
  },
  {
    re: /\b(FACEBK|FACEBOOK ADS|META ADS|GOOGLE\s*\*?\s*ADS|LINKEDIN ADS|TWITTER ADS|X ADS|REDDIT ADS|VISTAPRINT|MOO PRINT)\b/i,
    category: 'advertising',
    reason: 'Advertising or marketing.',
  },
  {
    re: /\b(STAPLES|OFFICE ?DEPOT|OFFICEMAX|USPS|FEDEX|UPS STORE|THE UPS|PITNEY)\b/i,
    category: 'supplies',
    reason: 'Office supplies or shipping for the business.',
  },
  {
    re: /\b(DELTA AIR|UNITED AIR|AMERICAN AIR|SOUTHWEST|JETBLUE|ALASKA AIR|SPIRIT AIR|FRONTIER AIR|MARRIOTT|HILTON|HYATT|IHG|HOLIDAY INN|AIRBNB|EXPEDIA|BOOKING\.COM|AMTRAK|HERTZ|AVIS|ENTERPRISE RENT)\b/i,
    category: 'travel',
    reason:
      'Travel away from home for business (flights, lodging, rental cars). Not personal trips.',
  },
  {
    re: /\b(VERIZON|AT&T|ATT\*|T-MOBILE|TMOBILE|COMCAST|XFINITY|SPECTRUM|COX COMM|GOOGLE FI|MINT MOBILE)\b/i,
    category: 'utilities',
    reason:
      'Phone/internet: only the business-use percentage is deductible. Confirm the share.',
  },
  {
    re: /\b(UPWORK|FIVERR|TOPTAL|99DESIGNS)\b/i,
    category: 'contract_labor',
    reason: 'Paid a contractor through a freelance marketplace.',
  },
  {
    re: /\b(LEGALZOOM|ROCKET LAWYER|CPA|ATTORNEY|LAW OFFICE|BOOKKEEP)\b/i,
    category: 'legal_professional',
    reason: 'Legal or accounting fees for the business.',
  },
  {
    re: /\b(HISCOX|NEXT INSURANCE|THIMBLE|BUSINESS INSURANCE)\b/i,
    category: 'insurance',
    reason: 'Business insurance (not health insurance).',
  },
  {
    re: /\b(SECRETARY OF STATE|BUSINESS LICENSE|LICENSE FEE|FRANCHISE TAX)\b/i,
    category: 'taxes_licenses',
    reason: 'Business license or registration fee.',
  },
  {
    re: /\b(WEWORK|REGUS|COWORK)\b/i,
    category: 'rent_property',
    reason: 'Rented work space.',
  },
  {
    re: /\b(RESTAURANT|CAFE|COFFEE|STARBUCKS|DOORDASH|UBER ?EATS|GRUBHUB|CHIPOTLE|SWEETGREEN)\b/i,
    category: 'meals',
    reason:
      'Meal: deductible (at 50%) only with a client or while traveling for business. Ask.',
  },
  {
    re: /\b(SHELL|CHEVRON|EXXON|MOBIL|BP#|ARCO|76 |SUNOCO|VALERO|PARKING|TOLL)\b/i,
    category: 'unsure',
    reason:
      'Gas/parking/tolls: if you use the standard mileage rate, gas is already covered. Ask.',
  },
  {
    re: /\b(UBER|LYFT)\b/i,
    category: 'unsure',
    reason: 'Ride share: business only if the trip was for work. Ask.',
  },
  {
    re: /\b(AMAZON|AMZN|WALMART|TARGET|COSTCO|BEST BUY|APPLE\.COM|APPLE STORE)\b/i,
    category: 'unsure',
    reason:
      'General retailer: could be business supplies or equipment, or personal. Ask.',
  },
  {
    re: /\b(VENMO|ZELLE|PAYPAL|CASH APP|ATM|TRANSFER|XFER)\b/i,
    category: 'unsure',
    reason: 'Transfer: not an expense by itself. Ask what it paid for.',
  },
  {
    re: /\b(WHOLE FOODS|TRADER JOE|SAFEWAY|KROGER|PUBLIX|ALDI|WEGMANS|GROCERY|NETFLIX|HULU|DISNEY|SPOTIFY|HBO|PELOTON|GYM|PLANET FITNESS|PHARMACY|CVS|WALGREENS|RENT PAYMENT|MORTGAGE)\b/i,
    category: 'personal',
    reason: 'Usually personal spending.',
  },
];

const BANK_CATEGORY: { re: RegExp; category: Proposal; reason: string }[] = [
  {
    re: /groceries|health|personal|entertainment|home|gifts|education/i,
    category: 'personal',
    reason: 'Bank category suggests personal spending.',
  },
  {
    re: /travel/i,
    category: 'travel',
    reason: 'Bank category: travel. Business trips only.',
  },
  {
    re: /office|business/i,
    category: 'supplies',
    reason: 'Bank category: office/business.',
  },
  {
    re: /bills|utilities/i,
    category: 'utilities',
    reason: 'Bank category: bills/utilities. Business share only.',
  },
  {
    re: /food|drink|dining/i,
    category: 'meals',
    reason: 'Bank category: food & drink. Business meals only (50%).',
  },
];

export function categorize(row: {
  description: string;
  bankCategory?: string;
}): {
  proposed: Proposal;
  reason: string;
} {
  for (const r of RULES)
    if (r.re.test(row.description))
      return { proposed: r.category, reason: r.reason };
  if (row.bankCategory) {
    for (const r of BANK_CATEGORY)
      if (r.re.test(row.bankCategory))
        return { proposed: r.category, reason: r.reason };
  }
  return { proposed: 'unsure', reason: 'No rule matched. Ask the user.' };
}
