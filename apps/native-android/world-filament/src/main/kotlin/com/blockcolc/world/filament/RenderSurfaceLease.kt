package com.blockcolc.world.filament

/** Surface callbacks run on the UI thread; swap chains belong to the render
 * thread. Serialize native acquisition with invalidation, not with each frame.
 * A queued callback must never acquire an already returned Android Surface. */
internal class RenderSurfaceLease {
    private var sequence=0L
    private var current:Long?=null
    private var owned:Long?=null

    @Synchronized fun begin():Long {
        val ticket=++sequence;check(ticket>0)
        current=ticket;return ticket
    }
    @Synchronized fun currentTicket():Long?=current
    @Synchronized fun isCurrent(ticket:Long)=current==ticket
    @Synchronized fun frameTicket():Long?=current?.takeIf{owned==it}

    /** Acquisition stays under the same lock as detach. Otherwise detach could
     * see no swap chain and return while the renderer is still creating one. */
    @Synchronized fun acquire(ticket:Long,create:()->Unit):Boolean {
        if(current!=ticket)return false
        create();owned=ticket;return true
    }
    @Synchronized fun detach():Boolean {
        current=null;return owned!=null
    }
    /** Only clear ownership after the driver-side destruction has completed.
     * A failed release remains outstanding so cleanup cannot report success. */
    @Synchronized fun retire(release:()->Unit):Boolean {
        if(owned==null)return false
        release();owned=null;return true
    }
}
