# SQL histórico (NO ejecutar)

Archivos previos a las migraciones versionadas, conservados como registro:

- `schema.sql`: esquema original. Su contenido es la migración `migrations/20260921000001_baseline.sql`.
- `fix_rls_policies.sql`: parche que abría RLS a cualquier usuario autenticado ([C1](../../docs/04-auditoria/hallazgos/C1-rls-permisivo.md)).
  **No se migra**: la migración `…_roles_rls.sql` elimina todas las políticas existentes (incluidas las que este parche haya creado en
  una base ya desplegada) y crea las definitivas.

Las referencias `archivo:línea` de `docs/04-auditoria/` apuntan a estos archivos tal como estaban en el commit `54962b9`.
