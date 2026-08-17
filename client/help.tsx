import classnames from "classnames"

import css from "./help.module.css"

type Props = {
	hide: boolean
	onHide: () => void
}

export function Help(props: Props) {
	const { hide } = props
	return (
		<div className={classnames(css.help, hide && css.hide)}>
			<p>
				Use the sidebar to move between the live channels, the Infinite Mixtapes
				and the schedule.
			</p>
			<p>
				Press 1 or 2 to play or stop a live channel.
				<br />
				The spacebar starts and stops whatever is selected.
			</p>
			<p>
				Use + and - or the up and down arrows to change the volume.
				<br />
				Ctrl + N shows the window from anywhere.
			</p>
			<p>
				The bar at the bottom shows connection status. Dropped streams reconnect on
				their own.
			</p>
			<p>Press ? to hide this help.</p>
		</div>
	)
}
