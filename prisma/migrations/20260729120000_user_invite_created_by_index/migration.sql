-- Cover the invite creator foreign key for joins and cascading deletes.
CREATE INDEX "UserInvite_createdById_idx"
  ON "UserInvite"("createdById");
