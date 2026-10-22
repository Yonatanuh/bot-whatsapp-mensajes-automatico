const test = require('node:test');
const assert = require('node:assert/strict');
const dbService = require('../services/dbService');

test('dbService handles client estado defaulting and persistence', async () => {
  const testEmail = 'test_status_user@example.com';
  
  // Add a client without estado
  const client1 = await dbService.addClient({
    ownerEmail: testEmail,
    nombre: 'Juan Perez',
    numero: '8095551234',
    nota: 'Prueba'
  });
  assert.equal(client1.estado, 'PENDIENTE', 'Default estado should be PENDIENTE');

  // Add a client with explicit estado
  const client2 = await dbService.addClient({
    ownerEmail: testEmail,
    nombre: 'Ana Gomez',
    numero: '8095555678',
    estado: 'VENCIDO'
  });
  assert.equal(client2.estado, 'VENCIDO');

  // Update estado
  const updated = await dbService.updateClient(client1.id, testEmail, {
    estado: 'PAGADO'
  });
  assert.equal(updated.estado, 'PAGADO');

  // Clean up
  await dbService.deleteClient(client1.id, testEmail);
  await dbService.deleteClient(client2.id, testEmail);
});

test('dbService handles schedules creation, retrieval, and deletion', async () => {
  const testEmail = 'test_scheduler_user@example.com';
  const futureIso = new Date(Date.now() + 3600000).toISOString();

  const newSchedule = await dbService.addSchedule({
    ownerEmail: testEmail,
    messageTemplate: 'Hola {{nombre}}, recordatorio de pago',
    scheduledAt: futureIso,
    filterEstado: 'PENDIENTE',
    delay: 3
  });

  assert.ok(newSchedule.id);
  assert.equal(newSchedule.status, 'SCHEDULED');
  assert.equal(newSchedule.filterEstado, 'PENDIENTE');

  const userSchedules = await dbService.getSchedulesForUser(testEmail);
  assert.ok(userSchedules.some(s => s.id === newSchedule.id));

  // Update schedule status
  const updated = await dbService.updateSchedule(newSchedule.id, { status: 'COMPLETED' });
  assert.equal(updated.status, 'COMPLETED');

  // Delete schedule
  const deleted = await dbService.deleteSchedule(newSchedule.id);
  assert.equal(deleted, true);

  const afterDelete = await dbService.getSchedulesForUser(testEmail);
  assert.ok(!afterDelete.some(s => s.id === newSchedule.id));
});

