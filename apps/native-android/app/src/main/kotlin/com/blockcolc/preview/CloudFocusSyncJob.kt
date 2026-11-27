package com.blockcolc.preview

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.util.Log

/** The local timer is the outbox. A one-shot job survives an offline phase
 * transition or a process stop and reuses the controller's sync lane. */
class CloudFocusSyncJob : JobService() {
    private var running: JobParameters? = null

    override fun onStartJob(params: JobParameters): Boolean {
        running = params
        val controller = NativeCloudController.get(this, PreviewRuntime.get(this))
        controller.flushPendingFocus { retry ->
            if (running === params) {
                running = null
                jobFinished(params, retry)
            }
        }
        return true
    }

    override fun onStopJob(params: JobParameters): Boolean {
        if (running?.jobId == params.jobId) running = null
        return true
    }

    companion object {
        private const val ID = 2807

        internal fun enqueue(context: Context) {
            val scheduler = context.getSystemService(JobScheduler::class.java)
            try {
                if (scheduler.allPendingJobs.any { it.id == ID }) return
                val job = JobInfo.Builder(ID, ComponentName(context, CloudFocusSyncJob::class.java))
                    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                    .setMinimumLatency(2_000)
                    .setBackoffCriteria(10_000, JobInfo.BACKOFF_POLICY_EXPONENTIAL)
                    .setPersisted(true)
                    .build()
                if (scheduler.schedule(job) != JobScheduler.RESULT_SUCCESS) {
                    Log.w("BlockcolcCloud", "Focus retry could not be scheduled")
                }
            } catch (error: RuntimeException) {
                Log.w("BlockcolcCloud", "Focus retry could not be scheduled", error)
            }
        }

        internal fun cancel(context: Context) {
            runCatching { context.getSystemService(JobScheduler::class.java).cancel(ID) }
                .onFailure { Log.w("BlockcolcCloud", "Could not clear acknowledged focus retry", it) }
        }
    }
}
