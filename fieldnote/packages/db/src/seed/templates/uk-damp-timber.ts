import type { Vertical } from '@fieldnote/shared';

/**
 * Vertical one: UK damp and timber survey.
 *
 * The section order, field labels and terminology below follow the structure of
 * a PCA-format damp and timber report. This file is the output of domain work,
 * not engineering work — it should be reviewed and signed off by a qualified
 * surveyor before it ships to a paying customer, and changed only through the
 * same route. A subtly wrong report format destroys credibility with exactly
 * the professionals we need as advocates.
 *
 * `extractionHint` is written for the model, not the user: it describes how the
 * value is usually phrased out loud on site, which is where domain expertise
 * turns into extraction accuracy.
 */

export interface SeedField {
  key: string;
  label: string;
  type: 'text' | 'long_text' | 'number' | 'boolean' | 'enum' | 'date' | 'multi_enum';
  required: boolean;
  enumValues?: string[];
  extractionHint?: string;
}

export interface SeedSection {
  key: string;
  title: string;
  guidance: string;
  fields: SeedField[];
}

export interface SeedTemplate {
  name: string;
  vertical: Vertical;
  pdfTemplate: string;
  /** Boost list handed to the ASR pass. Domain vocabulary the model mishears. */
  asrKeywords: string[];
  sections: SeedSection[];
}

export const ukDampTimberTemplate: SeedTemplate = {
  name: 'Damp and Timber Survey (PCA format)',
  vertical: 'uk_damp_timber',
  pdfTemplate: 'damp-timber',
  asrKeywords: [
    'hygrometer',
    'protimeter',
    'calcium carbide',
    'salt band',
    'hygroscopic',
    'rising damp',
    'penetrating damp',
    'condensation',
    'DPC',
    'damp proof course',
    'DPM',
    'sub-floor void',
    'sleeper wall',
    'joist',
    'wall plate',
    'wet rot',
    'dry rot',
    'Serpula lacrymans',
    'Coniophora puteana',
    'woodworm',
    'common furniture beetle',
    'Anobium punctatum',
    'death watch beetle',
    'frass',
    'flight holes',
    'mycelium',
    'fruiting body',
    'render',
    'pointing',
    'bridging',
    'spalling',
    'efflorescence',
    'tanking',
    'render coat',
    'gable',
    'soffit',
    'fascia',
    'cavity wall',
    'solid wall',
    'lath and plaster',
  ],
  sections: [
    {
      key: 'property',
      title: 'Property and instruction',
      guidance:
        'State the property type, approximate age, construction and who instructed the inspection.',
      fields: [
        {
          key: 'property_type',
          label: 'Property type',
          type: 'enum',
          required: true,
          enumValues: [
            'Detached house',
            'Semi-detached house',
            'Mid-terrace house',
            'End-terrace house',
            'Flat / apartment',
            'Bungalow',
            'Commercial',
            'Other',
          ],
          extractionHint:
            'Usually said early and casually, e.g. "this is a Victorian mid-terrace". Map the phrasing to the closest option.',
        },
        {
          key: 'approx_year_built',
          label: 'Approximate year of construction',
          type: 'text',
          required: false,
          extractionHint:
            'Often given as a period rather than a year ("Victorian", "1930s", "post-war"). Record what was said; do not convert to a numeric year.',
        },
        {
          key: 'wall_construction',
          label: 'Wall construction',
          type: 'enum',
          required: true,
          enumValues: ['Solid masonry', 'Cavity masonry', 'Timber frame', 'Mixed', 'Not established'],
          extractionHint:
            'Listen for "nine inch solid", "cavity", "brick and block". If the surveyor says they could not establish it, use "Not established".',
        },
        {
          key: 'occupied',
          label: 'Property occupied at time of inspection',
          type: 'boolean',
          required: false,
          extractionHint: 'Often implied ("the tenant showed me in", "the property is vacant").',
        },
        {
          key: 'weather_conditions',
          label: 'Weather at time of inspection',
          type: 'text',
          required: false,
          extractionHint:
            'Matters for moisture readings. Usually mentioned in passing at the start.',
        },
      ],
    },
    {
      key: 'external',
      title: 'External inspection',
      guidance:
        'Walk the elevations. Note ground levels, DPC, rainwater goods, pointing, render and anything bridging.',
      fields: [
        {
          key: 'ground_levels',
          label: 'External ground levels',
          type: 'long_text',
          required: true,
          extractionHint:
            'Look for statements about ground level relative to the DPC — "ground is above the DPC on the rear elevation", "levels are satisfactory".',
        },
        {
          key: 'dpc_present',
          label: 'Damp proof course observed',
          type: 'enum',
          required: true,
          enumValues: ['Present and visible', 'Present but bridged', 'Not visible', 'Absent'],
          extractionHint:
            'Distinguish "I can see a slate DPC" from "the DPC is bridged by the path". Bridging is a different finding from absence.',
        },
        {
          key: 'rainwater_goods',
          label: 'Rainwater goods',
          type: 'long_text',
          required: false,
          extractionHint:
            'Gutters, downpipes, hoppers. Note defects such as leaks, blockages or discharge against the wall.',
        },
        {
          key: 'pointing_render',
          label: 'Pointing and render condition',
          type: 'long_text',
          required: false,
          extractionHint:
            'Note cracked or blown render, eroded pointing, and cement render over soft brick.',
        },
        {
          key: 'external_defects',
          label: 'Other external defects contributing to dampness',
          type: 'long_text',
          required: false,
        },
      ],
    },
    {
      key: 'internal_damp',
      title: 'Internal dampness',
      guidance:
        'Room by room. Record instrument readings with the instrument used, and be explicit about which rooms were inspected.',
      fields: [
        {
          key: 'affected_areas',
          label: 'Areas affected by dampness',
          type: 'long_text',
          required: true,
          extractionHint:
            'Usually dictated room by room with wall orientation, e.g. "north wall of the front reception, up to about a metre".',
        },
        {
          key: 'damp_type',
          label: 'Type of dampness diagnosed',
          type: 'multi_enum',
          required: true,
          enumValues: [
            'Rising damp',
            'Penetrating damp',
            'Condensation',
            'Plumbing leak',
            'Construction moisture',
            'Hygroscopic salts',
            'No dampness identified',
          ],
          extractionHint:
            'More than one may apply. Only record a diagnosis the surveyor actually states — never infer it from readings alone.',
        },
        {
          key: 'instrument_used',
          label: 'Moisture measurement method',
          type: 'multi_enum',
          required: true,
          enumValues: [
            'Electrical resistance meter',
            'Radio frequency / capacitance meter',
            'Calcium carbide test',
            'Gravimetric analysis',
            'Hygrometer',
            'Visual only',
          ],
          extractionHint:
            'Often named by brand ("protimeter", "speedy test"). Map to the method, not the brand.',
        },
        {
          key: 'readings_summary',
          label: 'Summary of readings',
          type: 'long_text',
          required: true,
          extractionHint:
            'Numeric readings with location and height. Keep the surveyor\'s own units and qualifiers.',
        },
        {
          key: 'salt_contamination',
          label: 'Salt contamination observed',
          type: 'boolean',
          required: false,
          extractionHint: 'Listen for "salt band", "efflorescence", "hygroscopic salts present".',
        },
        {
          key: 'relative_humidity',
          label: 'Relative humidity (%)',
          type: 'number',
          required: false,
        },
        {
          key: 'ventilation',
          label: 'Ventilation and heating regime',
          type: 'long_text',
          required: false,
          extractionHint:
            'Relevant to condensation diagnosis: extract fans, trickle vents, drying laundry indoors, heating pattern.',
        },
      ],
    },
    {
      key: 'timber',
      title: 'Timber inspection',
      guidance:
        'Sub-floor timbers, roof timbers, joinery. Record what was accessible and what was not.',
      fields: [
        {
          key: 'areas_inspected',
          label: 'Timber areas inspected',
          type: 'long_text',
          required: true,
          extractionHint:
            'Be precise about access — "lifted boards to the front reception", "loft inspected from the hatch only".',
        },
        {
          key: 'fungal_decay',
          label: 'Fungal decay identified',
          type: 'enum',
          required: true,
          enumValues: [
            'None identified',
            'Wet rot (Coniophora puteana or similar)',
            'Dry rot (Serpula lacrymans)',
            'Both wet and dry rot',
            'Suspected, further investigation required',
          ],
          extractionHint:
            'Dry rot and wet rot carry very different remediation. Do not record a species unless the surveyor names one.',
        },
        {
          key: 'decay_extent',
          label: 'Extent and location of decay',
          type: 'long_text',
          required: false,
        },
        {
          key: 'wood_boring_insect',
          label: 'Wood boring insect activity',
          type: 'enum',
          required: true,
          enumValues: [
            'None identified',
            'Common furniture beetle — historic',
            'Common furniture beetle — active',
            'Death watch beetle',
            'House longhorn beetle',
            'Suspected, further investigation required',
          ],
          extractionHint:
            'Active versus historic is the key distinction — listen for "clean flight holes", "frass present", "old infestation".',
        },
        {
          key: 'timber_moisture_content',
          label: 'Timber moisture content (%)',
          type: 'number',
          required: false,
          extractionHint: 'Recorded as a percentage. Above roughly 20% supports a decay diagnosis.',
        },
        {
          key: 'sub_floor_ventilation',
          label: 'Sub-floor ventilation',
          type: 'long_text',
          required: false,
          extractionHint: 'Airbricks: present, blocked, insufficient, or absent.',
        },
      ],
    },
    {
      key: 'limitations',
      title: 'Limitations of inspection',
      guidance:
        'State clearly what could not be inspected and why. This section is the professional protection.',
      fields: [
        {
          key: 'areas_not_inspected',
          label: 'Areas not inspected',
          type: 'long_text',
          required: true,
          extractionHint:
            'Fitted furniture, fixed floor coverings, occupier possessions, insulation in the loft. Usually stated as "I could not access...".',
        },
        {
          key: 'further_investigation',
          label: 'Further investigation recommended',
          type: 'long_text',
          required: false,
        },
      ],
    },
    {
      key: 'recommendations',
      title: 'Conclusions and recommendations',
      guidance:
        'The remedial specification. Order the recommendations by priority, and separate cause from symptom.',
      fields: [
        {
          key: 'summary',
          label: 'Summary of findings',
          type: 'long_text',
          required: true,
          extractionHint:
            'Usually dictated last as a spoken summary. Preserve the surveyor\'s own emphasis and ordering.',
        },
        {
          key: 'remedial_works',
          label: 'Recommended remedial works',
          type: 'long_text',
          required: true,
          extractionHint:
            'Discrete items of work. Keep them as separate items rather than merging into prose.',
        },
        {
          key: 'priority',
          label: 'Overall priority',
          type: 'enum',
          required: true,
          enumValues: ['Urgent', 'High', 'Medium', 'Low', 'Monitor only'],
          extractionHint:
            'Stated as urgency language ("needs doing straight away", "keep an eye on it") rather than the word "priority".',
        },
        {
          key: 'estimated_cost',
          label: 'Indicative cost',
          type: 'text',
          required: false,
          extractionHint:
            'Only record a figure the surveyor actually gives. Never estimate one.',
        },
        {
          key: 'guarantee_offered',
          label: 'Guarantee offered',
          type: 'boolean',
          required: false,
        },
      ],
    },
  ],
};
