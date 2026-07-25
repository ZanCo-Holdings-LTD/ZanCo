import { Pressable, StyleSheet, Text } from 'react-native';

/**
 * Section chips.
 *
 * Tagging audio to a section makes structuring far more accurate, but it must
 * stay optional: an inspector who forgets to tap a chip has still said the
 * words, and the pipeline offers untagged audio to every section for exactly
 * that reason. Never block recording on a selection.
 */
const SECTIONS: { key: string; label: string }[] = [
  { key: 'property', label: 'Property' },
  { key: 'external', label: 'External' },
  { key: 'internal_damp', label: 'Damp' },
  { key: 'timber', label: 'Timber' },
  { key: 'limitations', label: 'Limitations' },
  { key: 'recommendations', label: 'Recommendations' },
];

export function SectionChips({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (key: string | null) => void;
}) {
  return (
    <>
      {SECTIONS.map((section) => {
        const active = selected === section.key;
        return (
          <Pressable
            key={section.key}
            onPress={() => onSelect(active ? null : section.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{section.label}</Text>
          </Pressable>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    marginHorizontal: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e5e5e5',
  },
  chipActive: { backgroundColor: '#1a1a1a', borderColor: '#1a1a1a' },
  label: { color: '#5c5c5c', fontSize: 15 },
  labelActive: { color: '#fff' },
});
