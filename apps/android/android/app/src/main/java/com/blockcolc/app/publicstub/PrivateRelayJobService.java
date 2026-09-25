package com.blockcolc.app;

import android.app.job.JobParameters;
import android.app.job.JobService;

/**
 * Standard-build placeholder for the optional relay scheduler.  It is never
 * enabled by the manifest; the private source overlay replaces this class.
 */
public final class PrivateRelayJobService extends JobService {
    @Override public boolean onStartJob(JobParameters parameters) { return false; }
    @Override public boolean onStopJob(JobParameters parameters) { return false; }
}
