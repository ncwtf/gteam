import { Express } from 'express';
import authRoutes from './auth';
import projectRoutes from './projects';
import documentRoutes from './documents';
import requirementRoutes from './requirements';
import issueRoutes from './issues';
import gitRoutes from './git';

export function setupRoutes(app: Express) {
  app.use('/api/auth', authRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/documents', documentRoutes);
  app.use('/api/requirements', requirementRoutes);
  app.use('/api/issues', issueRoutes);
  app.use('/api/git', gitRoutes);
}
