const GENERIC = {
  formal:       'Thank you for your email. I will review and respond in due course.',
  professional: 'Thank you for your email. I will review and respond shortly.',
  friendly:     'Thanks for reaching out — I\'ll get back to you soon.',
  brief:        'Received — will respond shortly.',
  warm:         'Thanks for reaching out — I\'ll look into this and get back to you.'
};

const TABLE = {
  meeting_request: {
    formal:       'Thank you for the meeting invitation. I will review my calendar and respond with my availability.',
    professional: 'Thank you for the meeting invitation. I will review and confirm my availability shortly.',
    friendly:     'Thanks for the invite — I\'ll take a look and get back to you on timing.',
    brief:        'Thanks — will confirm availability shortly.',
    warm:         'Thanks for the invite — I\'ll check my calendar and confirm shortly.'
  },
  financial: {
    formal:       'Thank you for the notice. I will review the details and revert in due course.',
    professional: 'Thank you for the notice. I will review the details and respond shortly.',
    friendly:     'Thanks for the heads-up — I\'ll look into it.',
    brief:        'Noted — will review shortly.',
    warm:         'Thanks for the notice — I\'ll review the details and follow up.'
  },
  legal: {
    formal:       'I acknowledge receipt of your notice. I will review the matter and respond through appropriate channels.',
    professional: 'I acknowledge receipt of your notice. I will review and respond accordingly.',
    friendly:     'I acknowledge receipt of your notice. I will review and respond accordingly.',
    brief:        'Acknowledged — reviewing.',
    warm:         'I acknowledge receipt of your notice. I will review and respond accordingly.'
  },
  travel: {
    formal:       'Thank you for the booking confirmation. I will review the itinerary and respond if any adjustments are needed.',
    professional: 'Thank you for the confirmation. I will check the details and follow up if needed.',
    friendly:     'Thanks for the booking info — I\'ll double-check the details and reach out if anything\'s off.',
    brief:        'Thanks — will verify details.',
    warm:         'Thanks for the booking details — I\'ll review and reach out if anything needs adjusting.'
  },
  pitch_deck: {
    formal:       'Thank you for sharing. I will review the materials and respond at my earliest convenience.',
    professional: 'Thanks for sending this through. I will review and get back to you.',
    friendly:     'Thanks for sharing — I\'ll take a look and circle back.',
    brief:        'Thanks — will review.',
    warm:         'Thanks for sharing this — I\'ll take a look and get back to you.'
  },
  fyi: {
    formal:       'Thank you for the update. Noted.',
    professional: 'Thank you for the update. Noted for my records.',
    friendly:     'Thanks for the heads-up!',
    brief:        'Noted.',
    warm:         'Thanks for the heads-up — noted!'
  },
  rewards_awards: {
    formal:       'Thank you for the notification. I will review and act as appropriate.',
    professional: 'Thank you for letting me know. I will review before the deadline.',
    friendly:     'Thanks — I\'ll take a look before these expire.',
    brief:        'Noted — will check before expiry.',
    warm:         'Thanks for letting me know — I\'ll review before the deadline.'
  },
  other: GENERIC
};

function buildTemplateReply(classification, tone) {
  const cat = classification?.category || 'other';
  const table = TABLE[cat] || GENERIC;
  if (cat === 'legal') return table.professional;
  return table[tone] || table.professional || GENERIC.professional;
}

module.exports = { buildTemplateReply, TABLE, GENERIC };
