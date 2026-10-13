/**
 * HostelRooms3D Component (Replaced by RoomAllocation)
 * Re-exports the modern RoomAllocation management dashboard.
 * Preserves backwards compatibility for any lingering references.
 */

import RoomAllocation from './RoomAllocation';

export default function HostelRooms3D(props) {
  return <RoomAllocation {...props} />;
}
