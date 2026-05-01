import { type SchemaTypeDefinition } from 'sanity'
import { userType } from './documents/userType'
import { availabilityType } from './documents/availabilityType'
import { meetingType } from './documents/meetingType'
import { bookingType } from './documents/bookingType'
import { googleCalendarConnectionType } from './documents/googleCalendarConnectionType'

import { timeInterval } from './objects/timeInterval'
import { daySchedule } from './objects/daySchedule'
import { location } from './objects/location'

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [
    // Documents
    userType,
    availabilityType,
    meetingType,
    bookingType,
    googleCalendarConnectionType,
    // Objects
    timeInterval,
    daySchedule,
    location,
  ],
}
