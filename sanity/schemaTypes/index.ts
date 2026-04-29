import { type SchemaTypeDefinition } from 'sanity'
import { userType } from './documents/userType'
import { availabilityType } from './documents/availabilityType'

import { timeInterval } from './objects/timeInterval'
import { daySchedule } from './objects/daySchedule'
import { location } from './objects/location'

export const schema: { types: SchemaTypeDefinition[] } = {
  types: [
    // Documents
    userType,
    availabilityType,
    // Objects
    timeInterval,
    daySchedule,
    location,
  ],
}
