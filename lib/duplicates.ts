// lib/duplicates.ts — blocks adding/renaming a student to an ID or name that already exists.
// Deleted students are not in the list, so their IDs can be used again.
import { Alert } from 'react-native';

const norm = (s: any) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

// Returns a message if the ID or name is taken, otherwise null. `exceptId` = the student being edited.
export function studentConflict(students: any[], id: any, name: any, exceptId?: any): string | null {
  const sid = norm(id), sname = norm(name);
  for (const s of students || []) {
    if (exceptId !== undefined && String(s.id) === String(exceptId)) continue;
    if (sid && norm(s.id) === sid) return `A student with ID ${String(s.id).trim()} already exists (${s.name || 'no name'}).`;
    if (sname && norm(s.name) === sname) return `A student named "${String(s.name).trim()}" already exists (ID ${s.id}).`;
  }
  return null;
}

// Use before saving. Returns true if it is OK to save, false (after showing an alert) if not.
export function checkStudent(students: any[], id: any, name: any, exceptId?: any): boolean {
  const msg = studentConflict(students, id, name, exceptId);
  if (msg) { Alert.alert('Student already exists', msg); return false; }
  return true;
}
