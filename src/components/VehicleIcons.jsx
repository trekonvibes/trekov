import { MODELS, vehicleSvg } from '../lib/vehicleArt'

const wrap = (kind) => ({ size = 40, id = 'v', colour = 'green', className = '' }) => (
  <span className={className} style={{ lineHeight: 0 }}
        dangerouslySetInnerHTML={{ __html: vehicleSvg(kind, { colour, size, id }) }} />
)

export const CarIcon = wrap('car')
export const BikeIcon = wrap('bike')

/** Everything in the vehicle picker, cars first. `base` is 'car' or 'bike'. */
export const VEHICLES = MODELS.map((m) => ({ ...m, Icon: wrap(m.id) }))

export { COLOURS, VEHICLE_SVG } from '../lib/vehicleArt'
