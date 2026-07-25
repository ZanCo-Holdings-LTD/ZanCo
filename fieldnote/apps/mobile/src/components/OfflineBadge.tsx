import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { queueStatus, type QueueStatus } from '../upload/queue';

/**
 * Connectivity and backlog, stated plainly.
 *
 * Informational, never a warning: being offline is the normal condition in a
 * loft or a plant room, and nothing about it stops the surveyor working. What
 * they do need to know is that the pending count is going down before they
 * leave site.
 */
export function OfflineBadge() {
  const [status, setStatus] = useState<QueueStatus>({ pending: 0, online: true, running: false });

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const next = await queueStatus();
      if (active) setStatus(next);
    };
    void poll();
    const timer = setInterval(() => void poll(), 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  if (status.online && status.pending === 0) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.text}>
        {status.online ? 'Uploading' : 'Offline'}
        {status.pending > 0 ? ` · ${status.pending} waiting` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'center',
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#fef6e4',
  },
  text: { fontSize: 13, color: '#8a6100' },
});
