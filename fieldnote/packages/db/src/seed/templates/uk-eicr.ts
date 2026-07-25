import type { SeedTemplate } from './uk-damp-timber.js';

/**
 * UK domestic EICR (BS 7671 Model Form 6).
 *
 * The observation codes below are the regulated set — C1, C2, C3, FI — and
 * their meanings are fixed by the standard, not by us. A model must never
 * invent a code or a schedule item: the enum is closed for exactly that reason.
 *
 * Ships disabled until a qualified electrician has signed off the field list.
 * An EICR with the wrong shape is not a cosmetic problem.
 */
export const ukEicrTemplate: SeedTemplate = {
  name: 'Electrical Installation Condition Report (BS 7671)',
  vertical: 'uk_eicr',
  pdfTemplate: 'eicr',
  asrKeywords: [
    'consumer unit',
    'RCD',
    'RCBO',
    'MCB',
    'earth bonding',
    'main protective bonding',
    'supplementary bonding',
    'Zs',
    'Ze',
    'earth fault loop impedance',
    'insulation resistance',
    'polarity',
    'ring final circuit',
    'radial circuit',
    'TN-S',
    'TN-C-S',
    'PME',
    'TT system',
    'SPD',
    'AFDD',
    'CPC',
    'circuit protective conductor',
    'megger',
    'prospective fault current',
  ],
  sections: [
    {
      key: 'installation',
      title: 'Details of the installation',
      guidance: 'Supply characteristics and the origin of the installation.',
      fields: [
        {
          key: 'earthing_arrangement',
          label: 'Earthing arrangement',
          type: 'enum',
          required: true,
          enumValues: ['TN-S', 'TN-C-S', 'TT', 'IT', 'Other'],
          extractionHint: 'Often said as "PME" — that is TN-C-S.',
        },
        {
          key: 'supply_polarity_confirmed',
          label: 'Supply polarity confirmed',
          type: 'boolean',
          required: true,
        },
        {
          key: 'ze',
          label: 'Ze (ohms)',
          type: 'number',
          required: false,
          extractionHint: 'External earth fault loop impedance, read at the origin.',
        },
        {
          key: 'prospective_fault_current',
          label: 'Prospective fault current (kA)',
          type: 'number',
          required: false,
        },
        {
          key: 'main_switch_rating',
          label: 'Main switch rating',
          type: 'text',
          required: false,
        },
      ],
    },
    {
      key: 'observations',
      title: 'Observations and recommendations',
      guidance:
        'Each observation carries a classification code. Never assign a code the inspector did not state.',
      fields: [
        {
          key: 'observations',
          label: 'Observations',
          type: 'long_text',
          required: true,
          extractionHint:
            'Dictated as a list, each with a code. Keep them as discrete numbered items, preserving the code exactly as stated.',
        },
        {
          key: 'highest_code',
          label: 'Highest classification code recorded',
          type: 'enum',
          required: true,
          enumValues: ['None', 'C3', 'C2', 'C1', 'FI'],
          extractionHint:
            'The most severe code among the observations. Do not derive severity from prose — take the stated codes only.',
        },
        {
          key: 'overall_assessment',
          label: 'Overall assessment of the installation',
          type: 'enum',
          required: true,
          enumValues: ['Satisfactory', 'Unsatisfactory'],
          extractionHint:
            'Determined by the codes: any C1, C2 or FI makes the installation unsatisfactory. Record only what the inspector states.',
        },
        {
          key: 'next_inspection',
          label: 'Recommended date of next inspection',
          type: 'text',
          required: false,
        },
      ],
    },
    {
      key: 'limitations',
      title: 'Extent and limitations',
      guidance: 'Agreed limitations and anything that could not be tested.',
      fields: [
        {
          key: 'extent_of_sampling',
          label: 'Extent of sampling',
          type: 'long_text',
          required: true,
        },
        {
          key: 'agreed_limitations',
          label: 'Agreed limitations',
          type: 'long_text',
          required: false,
        },
      ],
    },
  ],
};
